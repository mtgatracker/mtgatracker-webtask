'use latest';

const express = require('express'),
      router = express.Router();
const { MongoClient, ObjectID } = require('mongodb');
const {
  createAnonymousToken,
  createToken,
  random6DigitCode,
  routeDoc,
  sendDiscordMessage,
  userCollection,
  notificationCollection,
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

// covered: test_get_user_token
router.post('/auth-attempt/long-exp/', (req, res, next) => {
  console.log('/auth-attempt/long-exp/')
  const authRequest = req.body;

  let { username, accessCode } = authRequest;
  username = escapeRegExp(username)
  const { MONGO_URL, DATABASE, DISCORD_WEBHOOK } = req.webtaskContext.secrets;

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    let users = client.db(DATABASE).collection(userCollection);

    let usernameRegexp = new RegExp(`^${username}$`, "i")
    let userSearch = {username: {$regex: usernameRegexp}}

    users.findOne(userSearch, null, (err, result) => {
      if (result === undefined || result === null) {
        res.status(404).send({"error": "no user found with username " + username})
        return
      }

      let expireCheck = new Date()
      if (result.authLong !== undefined && result.authLong !== null && result.authLong.expires > expireCheck
          && result.authLong.accessCode == accessCode) {
            let token = createToken({"user": username, "long": true}, req.webtaskContext.secrets.JWT_SECRET, "1y")
            let yearMs = 52 * 7 * 24 * 60 * 60 * 1000;
            let cookieExpiration = new Date()
            cookieExpiration.setTime(cookieExpiration.getTime() + yearMs)
            res.cookie('access_token', token, {secure: true, expires: cookieExpiration})

            let existingTokens = result.authLong.tokens
            existingTokens.push(token.split(".")[2])
            while(existingTokens.length > 3) existingTokens.shift() // cut down to 3 allowed long tokens

            // reset token now
            let expiresDate = new Date()
            expiresDate.setMinutes(expiresDate.getMinutes() + 2)
            let newAuthObj = {
              expires: expiresDate,
              accessCode: random6DigitCode(),
              tokens: existingTokens
            }
            users.update({'username': result.username}, {$set: {authLong: newAuthObj}}, (err, mongoRes) => {
              res.status(200).send({token: token})
            })
      } else {
        res.status(400).send({"error": "auth_error"})
      }
    })
  })
})


// covered: test_get_user_token
router.post('/auth-request/long-exp/', (req, res, next) => {
  console.log('/auth-request/long-exp/')
  const authRequest = req.body;
  console.log(authRequest)
  let { username, silent } = authRequest;
  username = escapeRegExp(username)

  const { MONGO_URL, DATABASE, DISCORD_WEBHOOK } = req.webtaskContext.secrets;

  if (username === undefined || username === null) {
    res.status(400).send({"error": "invalid request"})
    return
  }

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    let users = client.db(DATABASE).collection(userCollection);

    let usernameRegexp = new RegExp(`^${username}$`, "i")
    let userSearch = {username: {$regex: usernameRegexp}}

    users.findOne(userSearch, null, (err, result) => {
      if (result === undefined || result === null) {
        res.status(404).send({"error": "no user found with username " + username})
        console.log(result)
        return
      }
      if (result.discordUsername === undefined || result.discordUsername === null) {
        console.log(result)
        res.status(404).send({"error": "discord mapping not found for " + username})
        return
      }

      // if the current code expires in less than 30 seconds, let's refresh
      let expireCheck = new Date()
      expireCheck.setSeconds(expireCheck.getSeconds() + 30)
      if (result.authLong !== undefined && result.authLong !== null && result.authLong.expires > expireCheck) {
        // this code is still ok; you have >30s to put it in
        let authObj = result.authLong;
        let msgUsername = result.discordUsername ? "Discord:" + result.discordUsername : "MTGA:" + username;
        let msg = msgUsername + "/" + authObj.accessCode + "/expires @ " + authObj.expires.toLocaleString("en-US", {timeZone: "America/Los_Angeles"})
        sendDiscordMessage(msg, DISCORD_WEBHOOK, silent).then(() => {
          res.status(200).send({"request": "sent", "username": result.username})
        })
      } else {
        // this code will expire in less than 30s; we will just make you a new one.
        let expiresDate = new Date()
        expiresDate.setMinutes(expiresDate.getMinutes() + 2)
        let oldTokens = [];
        if(result.authLong && result.authLong.tokens) {
          oldTokens = result.authLong.tokens
        }
        let newAuthObj = {
          expires: expiresDate,
          accessCode: random6DigitCode(),
          tokens: oldTokens
        }
        users.update({'username': result.username}, {$set: {authLong: newAuthObj}}, (err, mongoRes) => {
          console.log(mongoRes.result.nModified)
          if (silent != true) {
            let msgUsername = result.discordUsername ? "Discord:" + result.discordUsername : "MTGA:" + username;
            let msg = msgUsername + "/" + newAuthObj.accessCode + "/expires @ " + newAuthObj.expires.toLocaleString("en-US", {timeZone: "America/Los_Angeles"})

            sendDiscordMessage(msg, DISCORD_WEBHOOK, silent).then(() => {
              res.status(200).send({"request": "sent", "username": result.username})
            })
          } else {
            res.status(200).send({"request": "sent", "username": result.username})
          }
        })
      }
    })
  })
})

// covered: test_get_user_token
router.post('/auth-attempt', (req, res, next) => {
  console.log('/auth-attempt')
  const authRequest = req.body;

  let { username, accessCode } = authRequest;
  username = escapeRegExp(username)
  const { MONGO_URL, DATABASE, DISCORD_WEBHOOK } = req.webtaskContext.secrets;

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    let users = client.db(DATABASE).collection(userCollection);

    let usernameRegexp = new RegExp(`^${username}$`, "i")
    let userSearch = {username: {$regex: usernameRegexp}}

    users.findOne(userSearch, null, (err, result) => {
      if (result === undefined || result === null) {
        res.status(404).send({"error": "no user found with username " + username})
        return
      }

      let expireCheck = new Date()
      if (result.auth !== undefined && result.auth !== null && result.auth.expires > expireCheck
          && result.auth.accessCode == accessCode) {
            let token = createToken({"user": username}, req.webtaskContext.secrets.JWT_SECRET, "7d")
            let weekMs = 7 * 24 * 60 * 60 * 1000;
            let cookieExpiration = new Date()
            cookieExpiration.setTime(cookieExpiration.getTime() + weekMs)
            res.cookie('access_token', token, {secure: true, expires: cookieExpiration})

            // reset token now
            let expiresDate = new Date()
            expiresDate.setMinutes(expiresDate.getMinutes() + 2)
            let newAuthObj = {
              expires: expiresDate,
              accessCode: random6DigitCode()
            }
            users.update({'username': result.username}, {$set: {auth: newAuthObj}}, (err, mongoRes) => {
              res.status(200).send({token: token})
            })
      } else {
        res.status(400).send({"error": "auth_error"})
      }
    })
  })
})

// covered: test_get_user_token
router.post('/auth-request', (req, res, next) => {
  console.log('/user/auth-request')
  const authRequest = req.body;

  let { username, silent } = authRequest;
  username = escapeRegExp(username)

  const { MONGO_URL, DATABASE, DISCORD_WEBHOOK } = req.webtaskContext.secrets;

  if (username === undefined || username === null) {
    res.status(400).send({"error": "invalid request"})
    return
  }

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    let users = client.db(DATABASE).collection(userCollection);

    let usernameRegexp = new RegExp(`^${username}$`, "i")
    let userSearch = {username: {$regex: usernameRegexp}}

    users.findOne(userSearch, null, (err, result) => {
      if (result === undefined || result === null) {
        res.status(404).send({"error": "no user found with username " + username})
        return
      }

      if (result.discordUsername === undefined || result.discordUsername === null) {
        res.status(404).send({"error": "discord mapping not found for " + username})
        return
      }

      // if the current code expires in less than 30 seconds, let's refresh
      let expireCheck = new Date()
      expireCheck.setSeconds(expireCheck.getSeconds() + 30)
      if (result.auth !== undefined && result.auth !== null && result.auth.expires > expireCheck) {
        // this code is still ok; you have >30s to put it in
        let authObj = result.auth;
        let msgUsername = result.discordUsername ? "Discord:" + result.discordUsername : "MTGA:" + username;
        let msg = msgUsername + "/" + authObj.accessCode + "/expires @ " + authObj.expires.toLocaleString("en-US", {timeZone: "America/Los_Angeles"})
        sendDiscordMessage(msg, DISCORD_WEBHOOK, silent).then(() => {
          res.status(200).send({"request": "sent", "username": result.username})
        })
      } else {
        // this code will expire in less than 30s; we will just make you a new one.
        let expiresDate = new Date()
        expiresDate.setMinutes(expiresDate.getMinutes() + 2)
        let newAuthObj = {
          expires: expiresDate,
          accessCode: random6DigitCode()
        }
        users.update({'username': result.username}, {$set: {auth: newAuthObj}}, (err, mongoRes) => {
          console.log(mongoRes.result.nModified)
          if (silent != true) {
            let msgUsername = result.discordUsername ? "Discord:" + result.discordUsername : "MTGA:" + username;
            let msg = msgUsername + "/" + newAuthObj.accessCode + "/expires @ " + newAuthObj.expires.toLocaleString("en-US", {timeZone: "America/Los_Angeles"})

            sendDiscordMessage(msg, DISCORD_WEBHOOK, silent).then(() => {
              res.status(200).send({"request": "sent", "username": result.username})
            })
          } else {
            res.status(200).send({"request": "sent", "username": result.username})
          }
        })
      }
    })
  })
})

module.exports = router