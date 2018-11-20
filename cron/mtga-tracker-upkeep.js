'use latest';

import bodyParser from 'body-parser';
import express from 'express';
import Webtask from 'webtask-tools';
import { MongoClient, ObjectID } from 'mongodb';
import AWS from 'aws-sdk'

const BluebirdPromise = require('bluebird')
global.Promise = BluebirdPromise
Promise.onPossiblyUnhandledRejection((e, promise) => {
    throw e
})

const deckCollection = 'deck';
const gameCollection = 'game';
const userCollection = 'user';
const errorCollection = 'error';
const server = express();

server.use(bodyParser.json());

let moveOldRecordsToColdStorage = options => {

  let { S3_BUCKET, collection, timestamp } = options;

  return new Promise((resolve, reject) => {
    let s3 = new AWS.S3();

    let fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 3)

    let matchQuery = {
      "trackerIDHash": {"$exists": true},
      "historyKey": {"$exists": true},
      "date": {"$lte": fiveDaysAgo},
      "inColdStorage": {"$in": [null, false]},
      "permanent": {"$in": [null, false]}
    }

    let aggregation = [
      {$match: matchQuery},
      {$group:
        {_id: {trackerIDHash: "$trackerIDHash"}, count: {$sum: 1}}
      },
      {$sort: {"count": -1}},
      {$limit: 15}
    ]

    collection.aggregate(aggregation).toArray((err, aggResult) => {
      let uploadPromises = []
      let queryPromises = []
      for (let agg of aggResult) {
        if (agg.count < 40) {
          console.log(`skipping ${agg._id.trackerIDHash}, only ${agg.count} records`)
        } else {
          console.log(`continuing with ${agg._id.trackerIDHash}, ${agg.count} records`)
          let idMatchQuery = {
            "trackerIDHash": agg._id.trackerIDHash,
            "historyKey": {"$exists": true},
            "date": {"$lte": fiveDaysAgo},
            "inColdStorage": {"$in": [null, false]},
            "permanent": {"$in": [null, false]}
          }
          queryPromises.push(collection.find(idMatchQuery).limit(400).toArray())
        }
      }
      Promise.all(queryPromises).then(queryResults => {
        console.log(`all ${queryResults.length} promises complete`)
        let totalMoved = 0
        for (let games of queryResults) {
          let trackerIDDocMap = {}
          for (let game of games) {
            let { trackerIDHash } = game;
            if (!trackerIDDocMap[trackerIDHash]) trackerIDDocMap[trackerIDHash] = []
            trackerIDDocMap[trackerIDHash].push(game)
          }
          for (let trackerIDHash in trackerIDDocMap) {
            let records = trackerIDDocMap[trackerIDHash]
            let finalDocument = {recordCount: records.length, records: records, owner: trackerIDHash}
            let finalFilename = `${trackerIDHash}/cs_${trackerIDHash}_${Date.now()}.json`
            let testFileParams = {
              Bucket: S3_BUCKET,
              Body: JSON.stringify(finalDocument),
              Key: finalFilename
            }
            console.log(`writing ${records.length} records to cs (${finalFilename})`)
            totalMoved += records.length;
            uploadPromises.push(new Promise((innerResolve, reject) => {
              s3.upload(testFileParams, function (err, data) {
                console.log(`uploaded to s3! with err ${err}`)
                if (!err) {
                  let totalHistoriesRemoved = 0;
                  for (let record of records) {
                    record.inColdStorage = finalFilename
                    record.coldStorageRev = 1
                    totalHistoriesRemoved += Object.keys(record.historyKey).length;
                    record.gameHistory = []
                    record.historyKey = []
                    collection.save(record)
                  }
                  console.log(`removed ${totalHistoriesRemoved} history objects`)
                  innerResolve()
                }
              })
            }))
          }
        }
        Promise.all(uploadPromises).then(promiseResults => {
          console.log(`${promiseResults.length} upload promises complete`)
          console.log(totalMoved)
          let result = {moved: totalMoved}
          console.log(result)
          resolve(result)
        })
      })
    })

  })
}

server.post('/', (req, res, next) => {

  const { MONGO_URL, DATABASE, S3_USER, S3_ACCESS_KEY, S3_ACCESS_KEY_ID, S3_BUCKET } = req.webtaskContext.secrets;

  console.log("/ called, running scheduled tasks")
  AWS.config.update({
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_ACCESS_KEY
  });

  let timestamp = Date.now()

  console.log("we made an s3!")
  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    if (connectErr) return next(connectErr);
    let collection = client.db(DATABASE).collection(gameCollection)
    moveOldRecordsToColdStorage({collection: collection, S3_BUCKET: S3_BUCKET, timestamp: timestamp}).then(result => {
      res.status(200).send({coldStorageResult: result})
    })
  })

})

module.exports = Webtask.fromExpress(server);