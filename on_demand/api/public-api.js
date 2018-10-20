'use latest';

const express = require('express'),
      request = require('request'),
      jwt = require('jsonwebtoken'),
      crypto = require('crypto'),
      router = express.Router();

const { MongoClient, ObjectID } = require('mongodb');
const {
  createAnonymousToken,
  createToken,
  random6DigitCode,
  routeDoc,
  sendDiscordMessage,
  userCollection,
  trackerCollection,
  notificationCollection,
  verifyAndDecodeToken,
  getTwitchIDToken,
  getDiscordAccessToken,
  verifyDiscordAccessToken,
  generateInternalToken,
  getOrCreateUser,
  msanitize,
  assertStringOr400,
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

router.get('/version', (req, res, next) => {
  const { version } = req.webtaskContext.secrets;
  res.status(200).send({version: version})
})

// covered: test_get_anon_token
router.get('/tracker-notifications', (req, res, next) => {
  console.log("/public-api/tracker-notifications")
  const { MONGO_URL, DATABASE, DISCORD_WEBHOOK } = req.webtaskContext.secrets;

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    console.log(notificationCollection)
    let notifications = client.db(DATABASE).collection(notificationCollection);
    console.log("got notifications")
    notifications.find().toArray((err, docs) => {
      console.log("got array")
      res.status(200).send({notifications: docs})
    })
  })
})

// covered: test_get_anon_token
router.get('/anon-api-token', (req, res, next) => {
  console.log("/public-api/anon-api-token")
  let token = createAnonymousToken(req.webtaskContext.secrets.JWT_SECRET)
  let dayMs = 1 * 24 * 60 * 60 * 1000;
  let cookieExpiration = new Date()
  cookieExpiration.setTime(cookieExpiration.getTime() + dayMs)
  res.cookie('access_token', token, {secure: true, expires: cookieExpiration})
  res.status(200).send({token: token})
})

function escapeRegExp(str) {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}

router.post('/tracker-token/', (req, res, next) => {
  console.log('/tracker-token/')
  const { trackerID } = req.body;

  if (assertStringOr400(trackerID, res)) return;
  if (trackerID.length < 40) return res.status(400).send({"error": "token_lacks_sufficient_entropy"})

  const { MONGO_URL, DATABASE, TRACKER_HASH_SECRET } = req.webtaskContext.secrets;

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    let trackers = client.db(DATABASE).collection(trackerCollection);
    let trackerSearch = {trackerID: trackerID}

    trackers.findOne(trackerSearch, null, (err, result) => {
      if (result === undefined || result === null) {
        // need to make a tracker object
        let trackerIDHash = crypto.createHash('sha256').update(trackerID + TRACKER_HASH_SECRET).digest('hex')
        result = {
          trackerID: trackerID,
          trackerIDHash: trackerIDHash,
        }
        trackers.save(result)
      }

      let token = createToken(result, req.webtaskContext.secrets.JWT_SECRET, "1y")
      res.status(200).send({token: token})
    })
  })
})

router.post('/twitch-auth-attempt', (req, res, next) => {
  console.log('/twitch-auth-attempt')
  let { code } = req.body;
  let { MONGO_URL, TWITCH_CLIENT_ID, TWITCH_SECRET_ID, DATABASE, JWT_SECRET } = req.webtaskContext.secrets
  MongoClient.connect(MONGO_URL).then(dbClient => {
    options = {
      db: dbClient.db(DATABASE),
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_SECRET_ID,
      jwtSecret: JWT_SECRET,
      accessCode: code
    }
    getTwitchIDToken(options)
      .then(verifyAndDecodeToken)
      .then(generateInternalToken)
      .then(getOrCreateUser)
      .then(decodedObj => {
        res.status(200).send({token: decodedObj.id_token, decoded: decodedObj.decoded})
      }).catch(err => {
        // TODO: clean this up a bit
        res.status(500).send({"error": err})
      })
  })
})

router.post('/discord-auth-attempt', (req, res, next) => {
  console.log('/discord-auth-attempt')
  let { code } = req.body;
  let { MONGO_URL, DISCORD_CLIENT_ID, DISCORD_SECRET_ID, DATABASE, JWT_SECRET } = req.webtaskContext.secrets
  MongoClient.connect(MONGO_URL).then(dbClient => {
    options = {
      db: dbClient.db(DATABASE),
      client_id: DISCORD_CLIENT_ID,
      client_secret: DISCORD_SECRET_ID,
      jwtSecret: JWT_SECRET,
      accessCode: code,
    }
    getDiscordAccessToken(options)
      .then(verifyDiscordAccessToken)
      // discord doesn't support openID tokens :( we have to make one ourselves
      .then(generateInternalToken)
      .then(getOrCreateUser)
      .then(decodedObj => {
        res.status(200).send({token: decodedObj.id_token, decoded: decodedObj.decoded})
      }).catch(err => {
        // TODO: clean this up a bit
        res.status(500).send({"error": err})
      })
  })
})

// TODO: uncovered
// This will return only public drafts.
router.get('/draft/_id/:_id', (req, res, next) => {
  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;
  MongoClient.connect(MONGO_URL, (err, client) => {
    const { _id } = req.params;
    if (assertStringOr400(_id, res)) return;
    if (err) return next(err);
    client.db(DATABASE).collection(draftCollection).findOne({ _id: new ObjectID(_id), public: true }, (err, result) => {
      client.close();
      if (err) return next(err);
      cleanDraftRecord(result)
      console.log(result)
      if (result !== null)
      {
        let safe_result = {}
        safe_result.picks = result.picks
        safe_result.date = result.date
        safe_result._id = result.id
        res.status(200).send(safe_result)
      }
      else res.status(404).send(result)
    });
  });
});

module.exports = router
