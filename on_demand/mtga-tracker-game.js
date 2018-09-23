'use latest';

import bodyParser from 'body-parser';
import express from 'express';
import Webtask from 'webtask-tools';
import { MongoClient, ObjectID } from 'mongodb';

const ejwt = require('express-jwt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

//var iopipe = require('@iopipe/iopipe')({
//  token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhYTU3ODg3MS00YWViLTQ0ZmItYTZhZi00NDIyNTA5Zjk5MDAiLCJqdGkiOiJjNjlkM2JiOS0xNDk5LTRlYjAtOTgwZi03NjQ0NDQwMzYwMTQiLCJpYXQiOjE1MzQzODM1MDUsImlzcyI6Imh0dHBzOi8vaW9waXBlLmNvbSIsImF1ZCI6Imh0dHBzOi8vaW9waXBlLmNvbSxodHRwczovL21ldHJpY3MtYXBpLmlvcGlwZS5jb20vZXZlbnQvLGh0dHBzOi8vZ3JhcGhxbC5pb3BpcGUuY29tIn0.jFJtw4LAm3BB7mUXjNULDXk3dmBUuNSOxzWkgSXCnT8'
//});

var secrets; // babel makes it so we can't const this, I am pretty sure
//try {
  secrets = require('./secrets.js')
//} catch (e) {
//  secrets = require('./secrets-template.js')
//}

const {
  createAnonymousToken,
  createToken,
  differenceMinutes,
  Game,
  getCookieToken,
  getGameById,
  getGithubStats,
  getPublicName,
  logError,
  parseVersionString,
  random6DigitCode,
  randomString,
  routeDoc,
  sendDiscordMessage,
  deckCollection,
  gameCollection,
  userCollection,
  errorCollection,
  twitchJWKExpressSecret,
} = require('../util')

const BluebirdPromise = require('bluebird')
global.Promise = BluebirdPromise
Promise.onPossiblyUnhandledRejection((e, promise) => {
    throw e
})

const server = express();

server.use(bodyParser.json());

const publicAPI = require('./api/public-api')
const anonAPI = require('./api/anon-api')
const userAPI = require('./api/user-api')
const adminAPI = require('./api/admin-api')
const trackerAPI = require('./api/tracker-api')

const TWITCH_ISSUER = "https://id.twitch.tv/oauth2"
const LOCAL_ISSUER = "https://inspector.mtgatracker.com"

let userIsAdmin = (req, res, next) => {
  if (req.user.user == "Spencatro") {
    next()
  } else {
    res.status(400).send({"error": "you are not an admin, sorry :'("})
  }
}

let userUpToDate = (req, res, next) => {
  if (req.path == "/authorize-token") return next()
  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    if (connectErr) return next(connectErr);
    // find games from either tracker
    let games = client.db(DATABASE).collection(gameCollection)
    games.find({trackerIDHash: {$in: req.authorizedTrackers}}).sort({date: -1}).next().then(game => {
      if (!game) return res.status(400).send({"error": "no records"})
      if (game.clientVersionOK) return next()
      else {
       console.log(`Rejecting ${userKey}'s API request (locked), on record:'`)
       console.log(game)
       res.status(400).send({"error": "your account has been locked"})
      }
    })
  })
}

let attachAuthorizedTrackers = (req, res, next) => {
 const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;
  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    const { userKey } = req;
    if (connectErr) return next(connectErr);
    let users = client.db(DATABASE).collection(userCollection)
    users.findOne({userKey: userKey}).then(user => {
      if (!user) return res.status(400).send({"error": "no_user_found"})
      else if (user.authorizedTrackers.length == 0 && req.path != "/authorize-token") {
        return res.status(400).send({"error": "no records"})
      }
      else if (user.authorizedTrackers) {
        req.authorizedTrackers = user.authorizedTrackers;
        next()
      }
    })
  })
}


var secretCallback = function(req, header, payload, done){
  // twitch issuer: 'https://id.twitch.tv/oauth2'
  // mtgatracker issuer: 'https://inspector.mtgatracker.com'
  var issuer = payload.iss;
  if (issuer == LOCAL_ISSUER) {
    return done(null, req.webtaskContext.secrets.JWT_SECRET);
  } else if (issuer == TWITCH_ISSUER) {
    return twitchJWKExpressSecret(req, header, payload, done);
  } else {
    return done(new Error('missing_secret'))
  }
};

function attachTrackerID(req, res, next) {
  const { TRACKER_HASH_SECRET } = req.webtaskContext.secrets;
  let trackerIDHash = crypto.createHash('sha256').update(req.user.trackerID + TRACKER_HASH_SECRET).digest('hex')
  if (!req.user.trackerIDHash || !req.user.trackerID) res.status(401).send({"error": "not_authorized"})
  if (trackerIDHash != req.user.trackerIDHash) {
    return res.status(400).send({"error": "tracker_id_hash_does_not_match"})
  } else {
    req.body.trackerIDHash = req.user.trackerIDHash;
    return next()
  }
}

function attachUserKey(req, res, next) {
  if (req.user.iss == TWITCH_ISSUER) {
    req.userKey = `${req.user.sub}:twitch`
    return next()
  } else if (req.user.iss == LOCAL_ISSUER && req.user.proxyFor == "discord") {
    req.userKey = `${req.user.sub}:discord`
    return next()
  }
  res.status(400).send({"error": "cant_create_user_key"})
}

function ejwt_wrapper(req, res, next) {
  // https://github.com/auth0/node-jwks-rsa/tree/master/examples/express-demo
  return ejwt({ secret: secretCallback, getToken: getCookieToken })
    (req, res, next);
}

server.use('/public-api', publicAPI)
server.use('/api', ejwt_wrapper, attachUserKey, attachAuthorizedTrackers, userUpToDate, userAPI)
server.use('/anon-api', ejwt_wrapper, anonAPI)
server.use('/tracker-api', ejwt_wrapper, attachTrackerID, trackerAPI)
server.use('/admin-api', ejwt_wrapper, attachUserKey, userIsAdmin, adminAPI)

server.get('/', (req, res, next) => {
  res.status(200).send({
    "/public-api": routeDoc(publicAPI.stack),
    "/anon-api": routeDoc(anonAPI.stack),
    "/api": routeDoc(userAPI.stack),
    "/tracker-api": routeDoc(trackerAPI.stack),
  })
})

// no cover - not testable?
server.get('*', function(req, res) {
  console.log('retrieving page: ' + JSON.stringify(req.params))

  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;
  MongoClient.connect(MONGO_URL, (err, client) => {
   logError(client, DATABASE, {error: "unknown access: " +  JSON.stringify(req.params)}, (result, err) => {
      client.close();
      if (err) return next(err);
      res.status(404).send({error: "route is not valid", warning: "this access has been logged; if you are misusing this API, your address may be banned!"})
   })
  })
})

module.exports = Webtask.fromExpress(server)

/* attempts at using iopipe :( */

//let invContext;
//
//server.use((req, res, next) => {
//  console.log("global middleware says hello: " + invContext)
//  req.context = invContext;
//  return next();
//});

// also doesn't work
/*
module.exports = (context, req, cb) => iopipe((ctx, e, cb2) => {
  console.log(e)
  return Webtask.fromExpress(server)(ctx, e, cb2);
})(context, req, cb)
*/


//module.exports =  iopipe((event, context, next) => {
//  console.log("iopipe init " + next)
//  invContext = context;
//  return webtaskServer;
//})

/* doesn't work :(

*/