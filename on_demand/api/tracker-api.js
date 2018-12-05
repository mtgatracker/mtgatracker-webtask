'use latest';

const express = require('express'),
      router = express.Router();
const { MongoClient, ObjectID } = require('mongodb');
const _ = require("underscore")

import AWS from 'aws-sdk'
const crypto = require("crypto")

const {
  createAnonymousToken,
  createToken,
  cleanGameRecord,
  cleanGameRecords,
  cleanDraftRecords,
  clientVersionUpToDate,
  getGameById,
  DraftPick,
  Game,
  random6DigitCode,
  routeDoc,
  sendDiscordMessage,
  gameCollection,
  deckCollection,
  draftCollection,
  inventoryCollection,
  notificationCollection,
  assertStringOr400,
  msanitize,
} = require('../../util')

var secrets; // babel makes it so we can't const this, I am pretty sure
//try {
  secrets = require('../secrets')
//} catch (e) {
//  secrets = require('../secrets-template')
//}

router.get('/', (req, res, next) => {
  res.status(200).send({routes: routeDoc(router.stack)})
})

router.post("/draft-pick", (req, res, next) => {
  console.log("POST /draft-pick")
  res.status(501).send({"error": "please update MTGATracker to >= 5.0.0"})
})

router.post('/game', (req, res, next) => {
  console.log("POST /game")
  const model = req.body;

  let anonymousUserID;
  if (model.anonymousUserID) {
    anonymousUserID = model.anonymousUserID;
  } else if (model.players && model.players[0] && model.players[0].name) {
    anonymousUserID = crypto.createHash('md5').update(model.players[0].name).digest("hex")
  } else {
    console.log(model)
    return res.status(400).send({"invalid": "model"})
  }

  if (model.date === undefined) {
    model.date = new Date()
  } else {
    model.date = new Date(Date.parse(model.date))
  }

  let cleanModel = {
    date: model.date,
    anonymousUserID: anonymousUserID,
    client_version: model.client_version,
  } // in case someone tries to sneak junk in this way, filter it out

  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;

  MongoClient.connect(MONGO_URL, (err, client) => {
    if (model.gameID) {
      cleanModel.gameID = crypto.createHash('md5').update(model.gameID).digest("hex")
      getGameById(client, DATABASE, model.gameID, (result, err) => {
        if (result !== null) {
          res.status(400).send({error: "game already exists", game: result});
          return;
        }
        if (err) return next(err);
        client.db(DATABASE).collection(gameCollection).insertOne(cleanModel, (err, result) => {
          client.close();
          if (err) return next(err);
          res.status(501).send({"error": "please update MTGATracker to >= 5.0.0"});
          return
        })
      })
    } else {
      if (err) return next(err);
      client.db(DATABASE).collection(gameCollection).insertOne(cleanModel, (err, result) => {
        client.close();
        if (err) return next(err);
        res.status(501).send({"error": "please update MTGATracker to >= 5.0.0"});
        return
      })
    }
  })

  res.status(501).send({"error": "please update MTGATracker to >= 5.0.0"})
});


// TODO: uncovered
router.post('/inventory', (req, res, next) => {
  console.log("POST /inventory")
  res.status(501).send({"error": "please update MTGATracker to >= 5.0.0"})
});

router.post('/rankChange', (req, res, next) => {
  console.log("POST /rankChange")
  res.status(501).send({"error": "please update MTGATracker to >= 5.0.0"})
});

router.get('/games', (req, res, next) => {
  console.log("/tracker-api/games" + JSON.stringify(req.params))
  const { trackerIDHash } = req.user;

  if (assertStringOr400(trackerIDHash, res)) return;

  const addFilter = Object.assign({trackerIDHash: trackerIDHash})

  console.log(`=========================> using filter ${JSON.stringify(addFilter)}`)

  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    if (connectErr) return next(connectErr);
    client.db(DATABASE).collection("migrated").insert({trackerIDHash: trackerIDHash, date: new Date()})
    let collection = client.db(DATABASE).collection(gameCollection)
    let cursor = collection.find(addFilter).sort({date: -1});
    cursor.count(null, null, (err, count) => {
      cursor.toArray((cursorErr, docs) => {
        cleanGameRecords([trackerIDHash], docs)
        if (cursorErr) return next(cursorErr);
        res.status(200).send({
          docs: docs
        });
        client.close()
      })
    })
  })
})

router.get('/game/_id/:_id/from_cold_storage', (req, res, next) => {

  const { MONGO_URL, DATABASE, S3_USER, S3_ACCESS_KEY, S3_ACCESS_KEY_ID, S3_BUCKET } = req.webtaskContext.secrets;
  const { trackerIDHash } = req.user;

  if (assertStringOr400(trackerIDHash, res)) return;

  AWS.config.update({
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_ACCESS_KEY
  });

  let s3 = new AWS.S3();

  MongoClient.connect(MONGO_URL, (err, client) => {
    const { _id } = req.params;
    if (assertStringOr400(_id, res)) return;
    if (err) return next(err);
    client.db(DATABASE).collection(gameCollection).findOne({ _id: new ObjectID(_id)}, (err, result) => {
      client.close();
      if (err) return next(err);
      cleanGameRecord([trackerIDHash], result)
      if (trackerIDHash != result.trackerIDHash) return res.status(401).send({"error": "not authorized"})
      if (!result.inColdStorage) return res.status(400).send({"error": "record not in cold storage"})

      let testFileParams = {
        Bucket: S3_BUCKET,
        Key: result.inColdStorage
      }
      console.log(testFileParams)
      s3.getObject(testFileParams, (err, data) => {
        if (err) return res.status(400).send({"error": `during retrieval of ${result.inColdStorage}: ${err.message}`})
        let dataString = data.Body.toString()
        let csObj = JSON.parse(dataString)

        if (result.trackerIDHash != csObj.owner) return res.status(401).send({"error": "not_authorized"})
        cleanGameRecords([trackerIDHash], csObj.records)

        if (csObj !== null) return res.status(200).send(csObj)
        else return res.status(404).send({"error": "not found"})
      })

    });
  });
});

router.get('/drafts', (req, res, next) => {
  console.log("/api/drafts" + JSON.stringify(req.params))
  const { trackerIDHash } = req.user;

  if (assertStringOr400(trackerIDHash, res)) return;

  if (req.query.per_page) {
    var per_page = parseInt(req.query.per_page)
  } else {
    var per_page = 10;
  }
  const { page = 1 } = req.query;

  // TODO: see /games/ and add a similar draftFilter

  // authorizedTrackers is safe
  const addFilter = {trackerIDHash: trackerIDHash}

  console.log(`=========================> using filter ${JSON.stringify(addFilter)}`)

  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    if (connectErr) return next(connectErr);
    let collection = client.db(DATABASE).collection(draftCollection)
    let cursor = collection.find(addFilter).sort({date: -1});
    cursor.count(null, null, (err, count) => {
      let numPages = Math.ceil(count / per_page);
      let docCursor = cursor.skip((page - 1) * per_page)

      if (per_page != -1) {
        docCursor = docCursor.limit(per_page);
      }

      docCursor.toArray((cursorErr, docs) => {
        cleanDraftRecords(docs)
        if (cursorErr) return next(cursorErr);
        res.status(200).send({
          totalPages: numPages,
          page: page,
          docs: docs
        });
        client.close()
      })
    })
  })
})

module.exports = router
