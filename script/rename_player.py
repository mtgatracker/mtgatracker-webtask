import os
import pymongo

OLD_USERNAME = "OLD_USERNAME"
NEW_USERNAME = "NEW_USERNAME"

prod_url = "https://wt-bd90f3fae00b1572ed028d0340861e6a-0.run.webtask.io/mtga-tracker-game"
staging_url = "https://wt-bd90f3fae00b1572ed028d0340861e6a-0.run.webtask.io/mtga-tracker-game-staging"

# read secrets

prod_debug_password = None
prod_mongo_url = None
if os.path.exists("../secrets"):
    with open("../secrets", "r") as rf:
        for line in rf.readlines():
            key, value = line.strip().split("=")
            if key == "DEBUG_PASSWORD":
                prod_debug_password = value
            if key == "MONGO_URL":
                prod_mongo_url = value

print("WARNING: you are debugging on the prod server!")
root_url = prod_url
debug_password = prod_debug_password
mongo_url = prod_mongo_url

mongo_client = pymongo.MongoClient(mongo_url)

games = mongo_client["mtgatracker"]["game"]
decks = mongo_client["mtgatracker"]["deck"]
users = mongo_client["mtgatracker"]["user"]

old_decks = [deck for deck in decks.find({"owner": OLD_USERNAME})]
new_decks = [deck for deck in decks.find({"owner": NEW_USERNAME})]
old_games = [game for game in games.find({"hero": OLD_USERNAME})]

print("STOP! \n"
      "Go fix the user object. Check if there is an existing new user, if so, remove (or update) it. \n"
      "Update (or remove) the old user object. \n"
      "\n"
      "Press Enter when complete\n")

input()

print("about to migrate {} decks from {} to {}.".format(len(old_decks), OLD_USERNAME, NEW_USERNAME))
print("about to migrate {} games from {} to {}.".format(len(old_games), OLD_USERNAME, NEW_USERNAME))
print("Press enter to confirm")
input()

# deal with decks
for idx, old_deck in enumerate(old_decks):
    if idx % 100 == 0:
        print(".", end="")
    old_deck_id = old_deck["deckID"]
    for new_deck in new_decks:
        if new_deck["deckID"] == old_deck_id:
            new_deck["wins"] += old_deck["wins"]
            new_deck["wins"] = list(set(new_deck["wins"]))  # remove dupes
            new_deck["losses"] += old_deck["losses"]
            new_deck["losses"] = list(set(new_deck["losses"]))  # remove dupes
            decks.save(new_deck)
            # save it
            break
    else:  # we didn't find it
        old_deck["owner"] = NEW_USERNAME
        decks.save(old_deck)
        # save it
print("")
print("decks migrated")

# deal with games
for idx, old_game in enumerate(old_games):
    if idx % 100 == 0:
        print(".", end="")
    old_game["hero"] = NEW_USERNAME
    old_game["players"][0]["name"] = NEW_USERNAME
    games.save(old_game)
print("")
print("games migrated")
