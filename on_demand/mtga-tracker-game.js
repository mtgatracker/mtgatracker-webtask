'use latest';

import bodyParser from 'body-parser';
import express from 'express';
import Webtask from 'webtask-tools';
import { MongoClient, ObjectID } from 'mongodb';

const ejwt = require('express-jwt');
const jwt = require('jsonwebtoken');

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
  clientVersionUpToDate,
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
  errorCollection
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

let userIsAdmin = (req, res, next) => {
  if (req.user.user == "Spencatro") {
    next()
  } else {
    res.status(400).send({"error": "you are not an admin, sorry :'("})
  }
}

let userUpToDate = (req, res, next) => {
  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    const { user } = req.user;
    if (connectErr) return next(connectErr);
    let collection = client.db(DATABASE).collection(gameCollection)
    let cursor = collection.find({'hero': user}).sort({date: -1});
    cursor.next((err, doc) => {
      if (err) return next(err);
      if (!doc) {
        res.status(400).send({"error": "no records"})
      } else if (doc && doc.clientVersionOK) next()
      else {
       console.log(`Rejecting ${user}'s API request (locked), on record:'`)
       console.log(req.user.doc)
       res.status(400).send({"error": "your account has been locked"})
      }
    })
  })
}

function ejwt_wrapper(req, res, next) {
  return ejwt({ secret: req.webtaskContext.secrets.JWT_SECRET, getToken: getCookieToken })
    (req, res, next);
}

function unescapeUser(req, res, next) {
  // if you got to unescapeUser with no user token, you goofed
  if (!req.user.user) {
    res.status(400).send({"error": "bad_auth"})
  } else {
    req.user.user = req.user.user.replace(/\\/g, '')
    next()
  }
}

function revokableTokenValid(req, res, next) {
  if (!req.user.long) return res.status(400).send({"error": "incorrect_token"})
  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    const { user } = req.user;
    if (connectErr) return next(connectErr);
    let collection = client.db(DATABASE).collection(userCollection)
    collection.findOne({"username": user}).then(userObj => {
      if (userObj.authLong.tokens.includes(getCookieToken(req).split(".")[2])) next()
      else {
       console.log(`Rejecting ${user}'s LONG-TOKEN API request, on record:'`)
       console.log(req.user.doc)
       res.status(400).send({"error": "token_revoked"})
      }
    })
  })
}

function userTokenMatchesData(req, res, next) {
  // tracker uses root of tracker api to check if we're authed, there's no body posted here. next is fine in that case.
  if (req.originalUrl.endsWith("tracker-api/")) return next()
  const model = req.body;
  if (model.hero) {
    console.log(`validating token based on hero: ${model.hero}`)
    if (model.hero == req.user.user) return next()
  } else if(model.players) {
    console.log(`validating token based on model.player[0].name: ${model.players[0].name}`)
    if (model.players[0].name == req.user.user) return next()
  } else {
    return res.status(400).send({"error": "bad_format"})
  }
  console.log(`hero / player does not match, 400!`)
  return res.status(400).send({"error": "bad_auth"})
}

server.use('/public-api', publicAPI)
server.use('/api', ejwt_wrapper, unescapeUser, userUpToDate, userAPI)
server.use('/anon-api', ejwt_wrapper, anonAPI)
server.use('/tracker-api', ejwt_wrapper, unescapeUser, revokableTokenValid, userTokenMatchesData, trackerAPI)
server.use('/admin-api', ejwt_wrapper, unescapeUser, userIsAdmin, adminAPI)

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