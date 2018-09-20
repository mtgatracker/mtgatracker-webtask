'use latest';

const express = require('express'),
      router = express.Router();

const { cardsColors } = require("mtga")

const {
  clientVersionUpToDate,
  createAnonymousToken,
  createDeckFilter,
  createToken,
  cleanGameRecord,
  cleanGameRecords,
  cleanDraftRecord,
  cleanDraftRecords,
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
  collectionCollection,
  deckCollection,
  draftCollection,
  gameCollection,
  userCollection,
  errorCollection,
} = require('../../util')

var secrets; // babel makes it so we can't const this, I am pretty sure
//try {
  secrets = require('../secrets.js')
//} catch (e) {
//  secrets = require('../secrets-template.js')
//}

import { MongoClient, ObjectID } from 'mongodb';

router.get('/', (req, res, next) => {
  res.status(200).send({routes: routeDoc(router.stack)})
})


// covered: test_get_user_games
router.get('/games', (req, res, next) => {
  console.log("/api/games" + JSON.stringify(req.params))
  if (req.query.per_page) {
    var per_page = parseInt(req.query.per_page)
  } else {
    var per_page = 10;
  }
  const { page = 1 } = req.query;
  const { user } = req.user;
  const addFilter = Object.assign({'players.name': user}, createDeckFilter(req.query))

  console.log(`=========================> using filter ${JSON.stringify(addFilter)}`)

  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    if (connectErr) return next(connectErr);
    let collection = client.db(DATABASE).collection(gameCollection)
    let cursor = collection.find(addFilter).sort({date: -1});
    cursor.count(null, null, (err, count) => {
      let numPages = Math.ceil(count / per_page);
      let docCursor = cursor.skip((page - 1) * per_page).limit(per_page);

      docCursor.toArray((cursorErr, docs) => {
        cleanGameRecords(user, docs)
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

router.get('/deck/:deckID/winloss-colors', (req, res, next) => {

  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;

  console.log("/deck/winloss-colors" + JSON.stringify(req.params))
  const { user } = req.user;
  let colors = ["White", "Red", "Green", "Blue", "Black"]
  let colorCounts = {}
  colors.forEach(color => {
    colorCounts[color] = {wins: 0, total: 0}
  })

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    if (connectErr) return next(connectErr);
    let collection = client.db(DATABASE).collection(gameCollection)
    const addFilter = {'hero': user, 'players.0.deck.deckID': req.params.deckID}
    let allDeckGames = collection.find(addFilter)
    allDeckGames.toArray((err, gameArray) => {
      let allColorPromises = []
      gameArray.forEach(game => {
        let oppoCardIDs = Object.keys(game.players[1].deck.cards).map(x => parseInt(x, 10))
        let oppoColorPromise = cardsColors(oppoCardIDs)
        allColorPromises.push(oppoColorPromise)
      })
      Promise.all(allColorPromises).then(allPromiseResults => {
        for (let gameIdx in allPromiseResults) {

          colors = allPromiseResults[gameIdx]
          game = gameArray[gameIdx]

          colors.forEach(oppoColor => {
            if (oppoColor != "Colorless") {
              colorCounts[oppoColor].total += 1
              if (game.winner == user)
                colorCounts[oppoColor].wins += 1
            }
          })
        }
        res.status(200).send(colorCounts)
      })
    })
  })
})

router.get('/deck/:deckID/winloss-multicolors', (req, res, next) => {
  // note, for ordering keys:
  // 1: https://www.mtgsalvation.com/forums/magic-fundamentals/magic-general/529369-color-order-and-names-for-color-combinations
  // 2: https://www.reddit.com/r/magicTCG/comments/3h3x7q/color_combination_ordering_for_sorting_purposes/
  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;

  console.log("/deck/winloss-multicolors" + JSON.stringify(req.params))
  const { user } = req.user;
  let colorCounts = {}

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    if (connectErr) return next(connectErr);
    let collection = client.db(DATABASE).collection(gameCollection)
    const addFilter = {'hero': user, 'players.0.deck.deckID': req.params.deckID}
    let allDeckGames = collection.find(addFilter)
    console.log(addFilter)
    allDeckGames.toArray((err, gameArray) => {
      let allColorPromises = []
      gameArray.forEach(game => {
        let oppoCardIDs = Object.keys(game.players[1].deck.cards).map(x => parseInt(x, 10))
        let oppoColorPromise = cardsColors(oppoCardIDs)
        allColorPromises.push(oppoColorPromise)
      })

      Promise.all(allColorPromises).then(allColorPromiseResults => {
        for (let gameIdx in allColorPromiseResults) {

          colors = Array.from(allColorPromiseResults[gameIdx])
          colors.sort()

          game = gameArray[gameIdx]

          colorlessIndex = colors.indexOf("Colorless")
          if (colors.length > 1 && colorlessIndex != -1) {
            colors.splice(colorlessIndex, 1) // remove colorsless if it's not the only color
          }
          if (!Object.keys(colorCounts).includes(colors)) {
            colorCounts[colors] = {total: 0, wins: 0};
          }
          colorCounts[colors].total += 1
          if (game.winner == user) {
            colorCounts[colors].wins += 1
          }
        }
        res.status(200).send(colorCounts)
      })
    })
  })
})

router.post('/deck/:deckID/hide', (req, res, next) => {
  console.log("/api/deck/" + req.params.deckID + "/hide " + JSON.stringify(req.params))
  const { user } = req.user;
  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    let decks = client.db(DATABASE).collection(deckCollection)
    let deckPromise = decks.findOne({deckID: req.params.deckID, owner: user})
    deckPromise.then(deckObj => {
      deckObj.hidden = true;
      decks.save(deckObj)
      res.status(200).send({hidden: req.params.deckID})
    })
  })
})

router.post('/deck/:deckID/unhide', (req, res, next) => {
  console.log("/api/deck/" + req.params.deckID + "/unhide " + JSON.stringify(req.params))
  const { user } = req.user;
  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    let decks = client.db(DATABASE).collection(deckCollection)
    let deckPromise = decks.findOne({deckID: req.params.deckID, owner: user})
    deckPromise.then(deckObj => {
      deckObj.hidden = false;
      decks.save(deckObj)
      res.status(200).send({hidden: req.params.deckID})
    })
  })
})

// covered: test_get_user_decks
router.get('/decks', (req, res, next) => {
  console.log("/api/decks" + JSON.stringify(req.params))

  if (req.query.per_page) {
    var per_page = parseInt(req.query.per_page)
  } else {
    var per_page = 10;
  }

  const { page = 1 } = req.query;
  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    const { user } = req.user;
    if (connectErr) return next(connectErr);

    let decks = client.db(DATABASE).collection(deckCollection)
    filter = {owner: user}
    if (!req.query.includeHidden) {
        filter["hidden"] = {$ne: true}
    }
    decks.find(filter).toArray((err, deckArray) => {
      client.close();
      deckReturn = {}
      deckArray.map(x => deckReturn[x.deckID] = x)
      res.status(200).send(deckReturn)
    })
  })
})

// TODO uncovered
router.get('/decks/count', (req, res, next) => {
  console.log("/api/decks/count" + JSON.stringify(req.params))

  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    const { user } = req.user;
    if (connectErr) return next(connectErr);

    let decks = client.db(DATABASE).collection(deckCollection)
    filter = {owner: user}
    decks.find(filter).count(null, null, (err, count) => {
      client.close();
      res.status(200).send({numDecks: count})
    })
  })
})

// TODO uncovered
router.get('/time-stats', (req, res, next) => {
  console.log("/api/time-stats" + JSON.stringify(req.params))

  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    const { user } = req.user;
    if (connectErr) return next(connectErr);

    let games = client.db(DATABASE).collection(gameCollection)
    filter = {hero: user, elapsedTimeSeconds: {$exists: true}}
    console.log(filter)
    games.aggregate([
      {$match: filter},
      {
        $group: {
          _id: null,
          "totalTimeSeconds": {$sum: "$elapsedTimeSeconds"},
          "maxTimeSeconds": {$max: "$elapsedTimeSeconds"},
          "avgTimeSeconds": {$avg: "$elapsedTimeSeconds"},
        }
      }
    ]).toArray((err, timeStats) => {
      delete timeStats[0]._id
      res.status(200).send({timeStats: timeStats[0]})
    })
  })
})

// TODO: uncovered
router.get('/win-loss', (req, res, next) => {
  console.log("/api/win-loss" + JSON.stringify(req.params))

  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    const { user } = req.user;
    if (connectErr) return next(connectErr);

    let decks = client.db(DATABASE).collection(deckCollection)
    filter = {owner: user}

    decks.find(filter).toArray((err, deckArray) => {
      client.close();
      winLoss = {wins: 0, losses: 0}
      deckArray.forEach(deck => {
        winLoss.wins += deck.wins.length;
        winLoss.losses += deck.losses.length;
      })
      res.status(200).send(winLoss)
    })
  })
})


// TODO: uncovered
router.get('/event-breakdown', (req, res, next) => {
  console.log("/api/event-breakdown" + JSON.stringify(req.params))

  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    const { user } = req.user;
    if (connectErr) return next(connectErr);

    let games = client.db(DATABASE).collection(gameCollection)
    filter = {hero: user, eventID: {$exists: true}}

    games.aggregate([
      {$match: filter},
      {$group: {"_id":"$eventID" , "count": {$sum:1}}}
    ]).toArray((err, eventCounts) => {
      res.status(200).send({eventCounts: eventCounts})
    })
  })
})

// TODO: uncovered
router.get('/event-history', (req, res, next) => {
  console.log("/api/event-history" + JSON.stringify(req.params))

  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;

  MongoClient.connect(MONGO_URL, (connectErr, client) => {
    const { user } = req.user;
    if (connectErr) return next(connectErr);

    let games = client.db(DATABASE).collection(gameCollection)
    filter = {hero: user, eventID: {$exists: true}}

    games.find(filter).sort({date: -1}).limit(200).toArray((err, docs) => {
      docs.reverse()
      let firstDate = `${docs[0].date.getMonth() + 1}/${docs[0].date.getDate()}`
      let lastDate = `${docs[docs.length - 1].date.getMonth() + 1}/${docs[docs.length - 1].date.getDate()}`
      let allEventTypes = new Set(docs.map(x => x.eventID))
      let eventTypeWindows = {}
      for (let eventKey of allEventTypes) {
        eventTypeWindows[eventKey] = {
          windows: []
        }
      }
      console.log(allEventTypes)
      slidingWindows = []
      let windowSize = docs.length / 13
      console.log(`windowSize: ${windowSize}`)
      for (let i = 0; i < 11; i++) {
        let startIdx = i * windowSize;
        let endIdx = (i+3) * windowSize;
        console.log(endIdx)
        let windowRecords = docs.slice(startIdx, endIdx).map(x => x.eventID)
        let windowCounts = {}
        for (let eventType of allEventTypes) {
          windowCounts[eventType] = 0
        }
        for (let record of windowRecords) {
          windowCounts[record] += 1
        }
        for (let eventTypeKey in windowCounts) {
          windowCounts[eventTypeKey] = 100 * windowCounts[eventTypeKey] / windowRecords.length;
          eventTypeWindows[eventTypeKey].windows.push(windowCounts[eventTypeKey])
        }
      }
      res.status(200).send({eventTypeWindows: eventTypeWindows, firstDate: firstDate, lastDate: lastDate})
    })
  })
})

// covered: test_get_game
router.get('/collection', (req, res, next) => {
  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;
  const { user } = req.user;

  MongoClient.connect(MONGO_URL, (err, client) => {
    const { _id } = req.params;
    if (err) return next(err);
    let collection = client.db(DATABASE).collection(collectionCollection)
    collection.find({"owner": req.user.user}).sort({date: -1}).limit(1).next((err, result) => {
      client.close();
      if (err) return next(err);
      if (req.user.user != result.owner) res.status(401).send({"error": "not authorized"})
      if (result !== null) res.status(200).send(result)
      else res.status(404).send(result)
    });
  });
});

// covered: test_get_game
router.get('/game/_id/:_id', (req, res, next) => {
  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;
  const { user } = req.user;
  MongoClient.connect(MONGO_URL, (err, client) => {
    const { _id } = req.params;
    if (err) return next(err);
    client.db(DATABASE).collection(gameCollection).findOne({ _id: new ObjectID(_id) }, (err, result) => {
      client.close();
      if (err) return next(err);
      cleanGameRecord(user, result)
      if(req.user.user != result.hero && req.user.user != result.opponent) res.status(401).send({"error": "not authorized"})
      if (result !== null) res.status(200).send(result)
      else res.status(404).send(result)
    });
  });
});

// covered: test_get_game
router.get('/game/gameID/:gid', (req, res, next) => {
  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;
  const { user } = req.user;
  MongoClient.connect(MONGO_URL, (err, client) => {
    const gid = req.params.gid;
    getGameById(client, DATABASE, gid, (result, err) => {
      client.close();
      if (err) return next(err);
      cleanGameRecord(user, result)
      if(req.user.user != result.hero && req.user.user != result.opponent) res.status(401).send({"error": "not authorized"})
      if (result !== null) res.status(200).send(result)
      else res.status(404).send(result)
    });
  });
});

// TODO: uncovered
router.get('/draft/_id/:_id', (req, res, next) => {
  const { MONGO_URL, DATABASE } = req.webtaskContext.secrets;
  const { user } = req.user;
  MongoClient.connect(MONGO_URL, (err, client) => {
    const { _id } = req.params;
    if (err) return next(err);
    console.log("ok1")
    client.db(DATABASE).collection(draftCollection).findOne({ _id: new ObjectID(_id) }, (err, result) => {
      console.log("ok2")
      client.close();
      console.log("ok3")
      if (err) return next(err);
      cleanDraftRecord(result)
      console.log("ok4")
      console.log(result)
      if(req.user.user != result.hero) res.status(401).send({"error": "not authorized"})
      if (result !== null) res.status(200).send(result)
      else res.status(404).send(result)
    });
  });
});



// TODO: unconvered
router.get('/drafts', (req, res, next) => {
  console.log("/api/drafts" + JSON.stringify(req.params))
  if (req.query.per_page) {
    var per_page = parseInt(req.query.per_page)
  } else {
    var per_page = 10;
  }
  const { page = 1 } = req.query;
  const { user } = req.user;

  // TODO: see /games/ and add a similar draftFilter
  const addFilter = {'hero': user}

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