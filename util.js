const jwt = require('jsonwebtoken')
const BluebirdPromise = require('bluebird')
const request = require('request');
const backbone = require('backbone');
const jwksRsa = require('jwks-rsa');

var secrets;
//try {
  secrets = require('./on_demand/secrets.js')
//} catch (e) {
//  secrets = require('./on_demand/secrets-template.js')
//}

global.Promise = BluebirdPromise

Promise.onPossiblyUnhandledRejection((e, promise) => {
    throw e
})

// upgraded version of https://github.com/vkarpov15/mongo-sanitize/blob/master/index.js
// checks for nested $ commands!
let msanitize = v => {
  if (v instanceof Object) {
    for (var key in v) {
      if (/^\$/.test(key)) {
        delete v[key];
      } else {
        msanitize(v[key])
      }
    }
  }
  return v;
}

let assertStringOr400 = (val, res) => {
  if (!(typeof val === 'string' || val instanceof String)) return res.status(400).send({"error": "malformed_request"})
}

let Game = backbone.Model.extend({
  validate: function(attr) {
    let err = []
    if (attr.players === undefined) err.push("must have players")
    if (attr.winner === undefined) err.push("must have a winner")
    if (attr.gameID === undefined) err.push("must have a gameID")
    if (!Array.isArray(attr.players)) err.push("players must be an array")
    if(err.length) return err  // checkpoint
    if (attr.players.length === 0) err.push("players must not be empty")
    let winnerFound = false
    attr.players.forEach(function(player, idx) {
      if (player.name === undefined) err.push("players[" + idx + "] must have a name")
      if (player.userID === undefined) err.push("players[" + idx + "] must have a userID")
      if (player.deck === undefined) err.push("players[" + idx + "] must have a deck")
      if (player.name === attr.winner) winnerFound = true
    })
    if (!winnerFound) err.push("winner " + attr.winner + " not found in players")
    if(err.length) return err  // checkpoint
  }
})

let DraftPick = backbone.Model.extend({
  validate: function(attr) {
    let err = []
    if (attr.pack === undefined) err.push("must have pack")
    if (!Array.isArray(attr.pack)) err.push("pack must be array")
    if (attr.packNumber === undefined) err.push("must have packNumber")
    if (attr.pick === undefined) err.push("must have pick")
    if (attr.pickNumber === undefined) err.push("must have pickNumber")
    if (attr.playerID === undefined) err.push("must have playerID")
    if (attr.hero === undefined) err.push("must have hero")
    if (attr.draftID === undefined) err.push("must have draftID")
    if(err.length) return err  // checkpoint
  }
})

var latestVersion = null;
var latestVersionString = null;
var downloadCount = null;

const deckCollection = 'deck',
      gameCollection = 'game',
      feedbackCollection = 'feedback',
      draftCollection = 'draft',
      inventoryCollection = 'inventory',
      collectionCollection = 'collection',
      userCollection = 'user',
      trackerCollection = 'tracker',
      notificationCollection = 'tracker-notification',
      errorCollection = 'error';

let routeDoc = (routeStack) => {
  let routeDoc = {}
  routeStack.forEach((route, idx) => {
    if (route.route && route.route.path != "") {
      if (!routeDoc[route.route.path]) {
        routeDoc[route.route.path] = []
      }
      routeDoc[route.route.path].push(Object.keys(route.route.methods)[0])
    }
  })
  return routeDoc;
}

let random6DigitCode = () => {
  return Math.floor(Math.random()*900000) + 100000;
}

let createToken = (tokenData, jwtSecret, expiresIn) => {
  tokenData.iss = "https://inspector.mtgatracker.com"  // tell them we issued it
  return jwt.sign(tokenData, jwtSecret, {expiresIn: expiresIn})
}

let createAnonymousToken = (jwtSecret) => {
  return jwt.sign({"user": null, "anonymousClientID": random6DigitCode()}, jwtSecret, {expiresIn: "1d"})
}

// TODO: clean this mess up. this functionality is not published, so no one should be using it yet, but, like...
// what tf is going on here
let createDeckFilter = (query) => {
  queryObj = {}
  filterable = {
    //"colors": "notimplemented",
    //"colorsAgainst": "notimplemented",
    "deckID": "players.0.deck.deckID",
    "opponent": "opponent"}
  Object.keys(query).filter(key => Object.keys(filterable).includes(key)).forEach(key => {
    filterObj = query[key].toString()  // sanitize query inputs, juuuust to be safe

    // js doesn't allow literals as keys :(
    let matchFilter = {}
    matchFilter[`${filterable[key]}`] = filterObj

    // TODO: ....why this??
    let doesntExistFilter = {}
    doesntExistFilter[`${filterable[key]}`] = {$exists: false}

    if (queryObj["$and"] == undefined) queryObj["$and"] = []
    queryObj["$and"].push({
      $or: [ matchFilter, doesntExistFilter ]
      // match where they are equal, or the filter doesn't exist in the db, e.g. colors
      // TODO: .... ^ what??
    })
  })
  return queryObj
}

let getCookieToken = (req) => {
  console.log("get cookie token")
  if (req.headers.cookie && req.headers.cookie.split('=')[0] === 'access_token') {
    console.log("from cookie")
    return req.headers.cookie.split('=')[1];
  } else if (req.query && req.query.token) {
    console.log("from req.query.token")
    return req.query.token;
  } else if (req.headers && req.headers.token) {
    console.log("from req.headers.token")
    return req.headers.token;
  } else if (req.headers && req.headers.Authorization && req.headers.Authorization.split(" ")[0] === "access_token") {
    console.log("from query.headers.Authorization[access_token]")
    return req.headers.Authorization.split(" ")[1];
  } else if (req.body && req.body.token) {
    console.log("from body.token")
    return req.body.token;
  }
  console.log("none, null :(")
  return null;
}

let sendDiscordMessage = (message, webhook_url, silent) => {
  return new Promise((resolve, reject) => {
    if (silent) {
      resolve({ok: true})
    } else {
      request.post({
        url: webhook_url,
        body: {
          "content": message
          },
        json: true,
        headers: {'User-Agent': 'MTGATracker-Webtask'}
      }, (err, reqRes, data) => {
        if (err) reject(err)
        resolve({ok: true})
      })
    }
  })
}

let getGameById = (client, database, gameID, callback) => {
  return new Promise((resolve, reject) => {
    client.db(database).collection(gameCollection).findOne({ gameID: gameID }, null, function(err, result) {
      if (err) { reject() } else { resolve() }
      callback(result, err)
    })
  })
}

let logError = (client, database, error, callback) => {
  client.db(database).collection(errorCollection).insertOne(error, null, (err, result) => {
    callback(result, err)
  })
}

let parseVersionString = (versionStr) => {
  let version = {}
  let version_parts = versionStr.split("-")
  if (version_parts.length > 1)
    version.suffix = version_parts[1]
  let version_bits = version_parts[0].split(".")
  version.major = version_bits[0]
  version.medium = version_bits[1]
  version.minor = version_bits[2]
  return version;
}

let differenceMinutes = (date1, date2) => {
  if (typeof date1 === 'string')
    date1 = Date.parse(date1)
  if (typeof date2 === 'string')
    date1 = Date.parse(date2)
  let result = (date2 - date1) * 1.66667e-5
  console.log("differenceMinutes: it has been " + result)
  return result
}

let getGithubStats = (storage) => {
  return new Promise((resolve, reject) => {
    storage.get((err, storageData) => {
      // github rate limits are 1/min for unauthed requests, only allow every 2 min to be safe
      if (storageData === undefined || differenceMinutes(storageData.lastUpdated, Date.now()) >= 2) {
        let setTime = Date.now()
        if (storageData !== undefined && storageData.lastUpdated !== undefined)
          console.log("need to request gh api (has been " + differenceMinutes(storageData.lastUpdated, Date.now()) + " minutes)")
        else
          console.log("need to request gh data (cache is empty)")
        request.get({
          url: "https://api.github.com/repos/shawkinsl/mtga-tracker/releases",
          json: true,
          headers: {'User-Agent': 'MTGATracker-Webtask'}
        }, (err, res, data) => {
          if (err || data === undefined || data == null || (typeof data === 'object' && !(data instanceof Array))) {
            console.log("greppable: gh data was not array and was object")
            if (!storageData) {
              let fakeVersionStr = "3.5.7"
              storageData = {latestVersion: parseVersionString(fakeVersionStr), latestVersionString: latestVersionString, totalDownloads: 100, lastUpdated: new Date(), warning: "Warning: this is fake data!"}
            }
            storage.set(storageData, (err) => {})
            resolve(storageData)
          } else {
            let downloadCount = 0;
            data.forEach((elem, idx) => {
                elem.assets.forEach((asset, idx) => {
                    downloadCount += asset.download_count;
                })
            })
            latestVersionString = data[0].tag_name
            latestVersion = parseVersionString(latestVersionString);
            data = {latestVersion: latestVersion, latestVersionString: latestVersionString, totalDownloads: downloadCount, lastUpdated: setTime}
            storage.set(data, (err) => {})
            resolve(data)
          }
        })
      } else {
        resolve(storageData)
      }
    })
  })
}

  // TODO: DRY here and @ electron/renderer.js ?
let clientVersionUpToDate = (clientVersion, storage) => {
  return new Promise((resolve, reject) => {
    // check for a newer release, (but only once, don't want to hit github a million times)
    getGithubStats(storage).then(latestVersionObj => {
      let { latestVersion, latestVersionString } = latestVersionObj
      if (clientVersion === undefined) {
        resolve({ok: false, latest: latestVersion})
      } else {
        let appVersion = parseVersionString(clientVersion);
        let ok = false;
        if (appVersion != latestVersion) {
          // https://github.com/shawkinsl/mtga-tracker/issues/129
          if (appVersion.major < latestVersion.major || appVersion.medium < latestVersion.medium) {
            ok = false;
          } else if (latestVersion.suffix === undefined && appVersion.suffix !== undefined) {
            // client is x.y.z-beta, latest is x.y.z
            ok = false;
          } else {
            ok = true;
          }
        }
        resolve({ok: ok, latest: latestVersionString})
      }
    })
  })
}

let randomString = () => {
  return Math.random().toString(36).substr(2, 5) + Math.random().toString(36).substr(2, 5) + Math.random().toString(36).substr(2, 5)
}

let cleanDraftRecord = (record) => {
  if (record.picks) {
    for (let pick of record.picks) {
      if (pick.playerID) {
        delete pick.playerID
      }
    }
  }
}

let cleanDraftRecords = (records) => {
  records.forEach(cleanDraftRecord)
}

let cleanGameRecord = (authorizedTrackers, record) => {
  if (record.trackerIDHash && !authorizedTrackers.includes(record.trackerIDHash)) {
    record.opponent_owned = true;
    if (record.players) {
      record.players[0].deck.cards = {} // don't leak this info, requester is not authorized to see it
      record.players[0].deck.poolName = "Opponent-owned record" // don't leak this info, requester is not authorized to see it
      record.players[1].deck.poolName = "Cards you showed your opponent" // don't leak this info, requester is not authorized to see it
    }
  }
  if (record.players) {
    record.players.forEach(player => {
      delete player.userID // don't leak user ID's, the frontend doesn't need them
    })
  }
}

let cleanGameRecords = (requestingUser, records) => {
  records.forEach(record => {
    cleanGameRecord(requestingUser, record)
  })
}


const twitchJWKClientOptions = {
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
  jwksUri: 'https://id.twitch.tv/oauth2/keys'
}

const twitchJWKClient = jwksRsa(twitchJWKClientOptions)
// I wish we could reuse twitchJWKClient, but since they are only used in separate flows, the rate-limiting isn't
// going to help us here anyways.
const twitchJWKExpressSecret = jwksRsa.expressJwtSecret(twitchJWKClientOptions)

let findKeyMiddleware = jwkSet => {
  return (header, callback) => {
    jwkSet.getSigningKey(header.kid, function(err, key) {
      var signingKey = key.publicKey || key.rsaPublicKey;
      callback(null, signingKey);
    });
  }
}


let buildUrl = (url, params) => {
  return url + "?" + Object.keys(params).map(key => key + "=" + params[key]).join("&")
}

let getRefreshTokenFromDB = (options) => {
  return new Promise((resolve, reject) => {
    let { db, userKey } = options;
    let collection = db.collection(userCollection)
    collection.findOne({userKey: userKey}, null).then(findResult => {
      if (!findResult) return reject(new Error("no_user_found"))
      let { refreshToken } = findResult
      options.refresh_token = refreshToken
      return resolve(options)
    })
  })
}

let doTokenRefresh = (options) => {
  let rootUrl;
  if (options.issuer == "twitch") {
    options.client_secret = options.twitch_client_secret
    options.client_id = options.twitch_client_id
    rootUrl = "https://id.twitch.tv/oauth2/token"
  } else if (options.issuer == "discord") {
    options.client_secret = options.discord_client_secret
    options.client_id = options.discord_client_id
    rootUrl = "https://discordapp.com/api/oauth2/token"
    options.scope = "identify"
  }
  let { client_id, client_secret, refresh_token, access_token } = options
  return new Promise((resolve, reject) => {
    let params = {
      client_id: client_id,
      client_secret: client_secret,
      refresh_token: encodeURI(refresh_token),
      grant_type: "refresh_token",
      scope: "openid",
    }
    if (options.scope) params.scope = options.scope  // for discord only
    let tokenURL = buildUrl(rootUrl, params)
    request.post({
      url: tokenURL,
      json: true,
      headers: {'User-Agent': 'MTGATracker-Webtask'}
    }, (err, reqRes, data) => {
      if (err) return reject(err)
      if (reqRes.statusCode != 200) return reject(new Error(`token refresh returned ${reqRes.status}`))
      options.access_token = data.access_token
      options.refresh_token = data.refresh_token
      return resolve(options)
    })
  })

}

let getTwitchIDToken = (options) => {
  let { client_id, client_secret, accessCode } = options
  // TODO: generalize this somehow (maybe getToken(req, issuer, accessCode) ? )
  return new Promise((resolve, reject) => {
    let params = {
      client_id: client_id,
      client_secret: client_secret,
      code: accessCode,
      grant_type: "authorization_code",
      redirect_uri: "https://inspector.mtgatracker.com/twitchAuth"
    }
    let twitchTokenUrl = buildUrl("https://id.twitch.tv/oauth2/token", params)
    request.post({
      url: twitchTokenUrl,
      json: true,
      headers: {'User-Agent': 'MTGATracker-Webtask'}
    }, (err, reqRes, data) => {
      if (err) return reject(err)
      if (reqRes.statusCode != 200) return reject(new Error(`token ID returned ${reqRes.status}`))
      options.id_token = data.id_token
      options.access_token = data.access_token
      options.refresh_token = data.refresh_token
      options.issuer = "twitch"
      return resolve(options)
    })
  })
}

let verifyAndDecodeToken = (tokenObj) => {
  let { id_token, issuer } = tokenObj;
  return new Promise((resolve, reject) => {
    let keySet;
    if (issuer == "twitch") {
      keySet = twitchJWKClient;
    } else {
      return reject(`no matching keyset for issuer ${issuer}`)
    }
    jwt.verify(id_token, findKeyMiddleware(keySet), (err, decoded) => {
      if (err) {
        return reject(err)
      } else {
        tokenObj.username = decoded.preferred_username
        tokenObj.userId = decoded.sub
        return resolve(tokenObj)
      }
    })
  })
}

let getDiscordAccessToken = (options) => {
  let { client_id, client_secret, accessCode } = options
  // TODO: generalize this somehow (maybe getToken(req, issuer, accessCode) ? )
  return new Promise((resolve, reject) => {
    let params = {
      client_id: client_id,
      client_secret: client_secret,
      code: accessCode,
      grant_type: "authorization_code",
      scope: "identify",
      redirect_uri: "https://inspector.mtgatracker.com/discordAuth"
    }
    let discordTokenUrl = buildUrl("https://discordapp.com/api/oauth2/token", params)
    request.post({
      url: discordTokenUrl,
      json: true,
      headers: {'User-Agent': 'MTGATracker-Webtask'},
    }, (err, reqRes, data) => {
      if (err) return reject(err)
      if (reqRes.statusCode != 200) return reject(new Error(`discord access token returned ${reqRes.status}`))
      options.id_token = data.id_token
      options.access_token = data.access_token
      options.refresh_token = data.refresh_token
      options.issuer = "discord"
      return resolve(options)
    })
  })
}

let verifyAccessToken = (tokenObj) => {
  return new Promise((resolve, reject) => {
    let { access_token, issuer } = tokenObj;
    let verifyUrl;
    let authString;
    if (tokenObj.issuer == "discord") {
      verifyUrl = "https://discordapp.com/api/users/@me"
      authString = `Bearer ${access_token}`
    } else if (tokenObj.issuer == "twitch") {
      verifyUrl = "https://id.twitch.tv/oauth2/validate"
      authString = `OAuth ${access_token}`
    }
    request.get({
      url: verifyUrl,
      headers: {
        'Authorization': authString
      },
      json: true
    }, (err, reqRes, data) => {
      if (err ) {
        return reject(err)
      } else if (reqRes.statusCode != 200) {
        return reject(new Error(`token refresh returned ${reqRes.status}`))
      } else {
        // set username and subject ID so we can generate a token
        if (tokenObj.issuer == "twitch") {
          tokenObj.username = data.login
          tokenObj.userId = data.user_id
        } else if (tokenObj.issuer == "discord") {
          tokenObj.username = data.username
          tokenObj.userId = data.id
        }
        return resolve(tokenObj)
      }
    })
  })
}

let generateInternalToken = (options, req) => {
  return new Promise((resolve, reject) => {
     options.decoded = {preferred_username: options.username, sub: options.userId}
     if (options.issuer) {
       options.decoded.proxyFor = options.issuer;
     } else if (options.proxyFor) {
       options.decoded.proxyFor = options.proxyFor
     }
     options.id_token = createToken(options.decoded, options.jwtSecret, "2 hours")
     if (req) req.user = options.decoded;
     resolve(options)
  })
}

let getOrCreateUser = options => {
  return new Promise((resolve, reject) => {
    let { access_token, refresh_token, decoded, issuer, db, id_token } = options;
    let { preferred_username, sub } = decoded;

    let userKey = `${sub}:${issuer}`
    let collection = db.collection(userCollection)

    return collection.findOne({userKey: userKey}, null).then(findResult => {
      if (findResult) {
        options.user = findResult;
        findResult.refreshToken = refresh_token
        findResult.accessToken = access_token
        collection.save(findResult)
        resolve(options)
      } else {
        // make a new result we can save
        let result = {
          userKey: userKey,
          username: preferred_username,
          isUser: true,
          hiddenDecks: [],
          authorizedTrackers: [],
          accessToken: access_token,
          refreshToken: refresh_token,
          issuer: issuer,
          idToken: id_token,
        }
        collection.save(result).then(saveResult => {
          options.user = result;
          resolve(options)
        })
      }
    })
  })
}

module.exports = {
  randomString: randomString,
  clientVersionUpToDate: clientVersionUpToDate,
  getGithubStats: getGithubStats,
  cleanGameRecords: cleanGameRecords,
  cleanGameRecord: cleanGameRecord,
  cleanDraftRecord: cleanDraftRecord,
  cleanDraftRecords: cleanDraftRecords,
  differenceMinutes: differenceMinutes,
  parseVersionString: parseVersionString,
  logError: logError,
  getGameById: getGameById,
  sendDiscordMessage: sendDiscordMessage,
  getCookieToken: getCookieToken,
  createAnonymousToken: createAnonymousToken,
  createToken: createToken,
  random6DigitCode: random6DigitCode,
  routeDoc: routeDoc,
  deckCollection: deckCollection,
  gameCollection: gameCollection,
  feedbackCollection: feedbackCollection,
  userCollection: userCollection,
  trackerCollection: trackerCollection,
  errorCollection: errorCollection,
  inventoryCollection: inventoryCollection,
  draftCollection: draftCollection,
  Game: Game,
  DraftPick: DraftPick,
  createDeckFilter: createDeckFilter,
  notificationCollection: notificationCollection,
  verifyAndDecodeToken: verifyAndDecodeToken,
  verifyAccessToken: verifyAccessToken,
  getRefreshTokenFromDB: getRefreshTokenFromDB,
  doTokenRefresh: doTokenRefresh,
  getTwitchIDToken: getTwitchIDToken,
  getDiscordAccessToken: getDiscordAccessToken,
  generateInternalToken: generateInternalToken,
  getOrCreateUser: getOrCreateUser,
  twitchJWKExpressSecret: twitchJWKExpressSecret,
  msanitize: msanitize,
  assertStringOr400: assertStringOr400,
}
