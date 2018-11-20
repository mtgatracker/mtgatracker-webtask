import pprint
import random
import string
import copy
import os

import datetime
import pytest
import pymongo
import time
import requests
import sys
import jwt

from dateutil.parser import parse as parse_date

delay = 1.5
staging_mongo_url = os.getenv("MONGO_URL")
if "--local" in sys.argv:
    url = "http://localhost:8080"
    delay = 0
if os.path.exists("secrets-staging"):
    with open("secrets-staging", "r") as rf:
        for line in rf.readlines():
            key, value = line.strip().split("=")
            if key == "MONGO_URL" and not staging_mongo_url:
                staging_mongo_url = value


mongo_client = pymongo.MongoClient(staging_mongo_url)
database = mongo_client['mtga-tracker-staging']
games_collection = database['game']
users_collection = database['user']

url = "https://wt-bd90f3fae00b1572ed028d0340861e6a-0.sandbox.auth0-extend.com/mtga-tracker-game-staging"


def post(post_url, post_json, raw_result=False, headers=None):
    post_json_str = str(post_json)
    if len(post_json_str) > 30:
        print("POST {} / {}".format(post_url, post_json_str[:30] + "..."))
    else:
        print("POST {} / {}".format(post_url, post_json))
    time.sleep(delay)
    result = requests.post(post_url, json=post_json, headers=headers)
    if raw_result:
        return result
    return result.json()


def get(get_url, raw_result=False, headers=None):
    print("GET {}".format(get_url))
    time.sleep(delay)
    result = requests.get(get_url, headers=headers)
    if raw_result:
        return result
    return result.json()


def delete(delete_url, raw_result=False, headers=None):
    print("DELETE {}".format(delete_url))
    time.sleep(delay)
    result = requests.delete(delete_url, headers=headers)
    if raw_result:
        return result
    return result.json()


_game_shell_schema_0 = {
    "schemaver": 0,  # this will not be present on actual records
    "gameID": 0,
    "winner": "joe",
    "players": [
        {
            "name": "joe",
            "userID": "123-456-789",
            "deck": {
                "deckID": "123-joe-456",
                "poolName": "Joe The Hero's Deck",
                "cards": {
                    "123": 1,
                    "1234": 3,
                }
            }
        },
        {
            "name": "tess",
            "userID": "123-456-790",
            "deck": {
                "deckID": "123-tess-456",
                "poolName": "tess's visible cards",
                "cards": {
                    "123": 60,
                    "1234": 3,
                }
            }
        }
    ]
}
res = get("https://wt-bd90f3fae00b1572ed028d0340861e6a-0.run.webtask.io/mtga-tracker-game/gh-stat-cache")
latest_client_version = res.get("latestVersionString", "3.1.0")

_game_shell_schema_1_1_0_beta = copy.deepcopy(_game_shell_schema_0)
_game_shell_schema_1_1_0_beta["hero"] = "joe"
_game_shell_schema_1_1_0_beta["client_version"] = latest_client_version

_game_shell_schema_1_1_1_beta = copy.deepcopy(_game_shell_schema_1_1_0_beta)
_game_shell_schema_1_1_1_beta['opponent'] = "tess"


def _random_string():
    return ''.join(random.choice(string.ascii_uppercase + string.digits) for _ in range(10))


def _post_games(games, admin_token, no_verify=False):
    post_url = url + "/admin-api/games"
    if no_verify:
        post_url += "/no-verify"
    return games, post(post_url, post_json={"games": games}, headers={"token": admin_token})


def post_random_games(games=None, num_games=None, admin_token=None, no_verify=False, game_shell=_game_shell_schema_1_1_0_beta):
    if games is None:
        games = [copy.deepcopy(game_shell) for _ in range(num_games or 3)]
        for game in games:
            game["gameID"] = _random_string()
    time.sleep(len(games) / 200.0)
    result = _post_games(games, admin_token, no_verify)
    time.sleep(len(games) / 200.0)
    return result


def _post_game(game, no_verify=False, token=None, use_public_api=False):
    if token is None:
        token = get_anon_token()
    if use_public_api:
        post_url = url + "/game"
    else:
        post_url = url + "/anon-api/game"
    if no_verify:
        post_url += "/no-verify"
    return game, post(post_url, post_json=game, headers={"token": token})


def get_anon_token():
    return get(url + "/public-api/anon-api-token")["token"]


def get_user_token(username):
    request_auth(username, force_discord=True)
    time.sleep(0.5)
    user_after_auth_request = users_collection.find_one({"username": username})
    access_code = int(user_after_auth_request["auth"]["accessCode"])
    return post(url + "/public-api/auth-attempt", post_json={"username": username, "accessCode": access_code})["token"]


def hide_deck(deck_id, token):
    post_url = url + "/api/deck/{}/hide".format(deck_id)
    print("POST /api/deck/{}/hide {}".format(deck_id, {"token": token}))
    return post(post_url, post_json={}, headers={"token": token})


def unhide_deck(deck_id, token):
    post_url = url + "/api/deck/{}/unhide".format(deck_id)
    print("POST /api/deck/{}/hide {}".format(deck_id, {"token": token}))
    return post(post_url, post_json={}, headers={"token": token})


def post_random_game(winner=None, loser=None, hero=None, opponent=None, winner_id=None, loser_id=None,
                     client_version=None, no_verify=False, game_shell=_game_shell_schema_1_1_0_beta,
                     token=None, winner_deck_id=None):
    if token is None:
        token = get_anon_token()
    game = copy.deepcopy(game_shell)
    game["gameID"] = _random_string()
    if hero:
        game["hero"] = hero
    if opponent:
        game["opponent"] = opponent
    if winner:
        game["winner"] = winner
        game["players"][0]["name"] = winner
        game["players"][0]["deck"]["poolName"] = "{} The Hero's Deck".format(winner)
    if loser:
        game["players"][1]["name"] = loser
        game["players"][1]["deck"]["poolName"] = "{}'s visible cards".format(loser)
    if winner_id:
        game["players"][0]["userID"] = winner_id
    if loser_id:
        game["players"][1]["userID"] = loser_id
    if client_version:
        game["client_version"] = client_version
    if winner_deck_id:
        game["players"][0]["deck"]["deckID"] = winner_deck_id
    return _post_game(game, no_verify, token=token)


def post_bad_game(missing_winner_name=False, missing_loser_name=False,
                  missing_winning_deck=False, missing_losing_deck=False,
                  missing_winner_user_id=False, missing_loser_user_id=False,
                  no_winner_defined=False, missing_game_id=False,
                  players_undefined=False, players_not_list=False, players_empty=False,
                  no_verify=False):
    game = copy.deepcopy(_game_shell_schema_0)
    if missing_winner_name:
        del game["players"][0]["name"]
    if missing_loser_name:
        del game["players"][1]["name"]
    if missing_winner_user_id:
        del game["players"][0]["userID"]
    if missing_loser_user_id:
        del game["players"][1]["userID"]
    if missing_winning_deck:
        del game["players"][0]["deck"]
    if missing_losing_deck:
        del game["players"][1]["deck"]
    if no_winner_defined:
        del game["winner"]
    if missing_game_id:
        del game["gameID"]
    if players_undefined:
        del game["players"]
    if players_not_list:
        game["players"] = {"not": "list"}
    if players_empty:
        game["players"] = []

    return _post_game(game, no_verify)


def insert_taken_user(username=None, public_name=None, is_user=False, discord_username=None):
    if username is None:
        username = _random_string()
    if public_name is None:
        public_name = _random_string()

    user_obj = {"username": username, "available": False, "publicName": public_name, "isUser": is_user}
    if discord_username:
        user_obj["discordUsername"] = discord_username
    users_collection.insert_one(user_obj)


def request_auth(username, silent=True, force_discord=False):
    if force_discord:
        users_collection.update_one({"username": username}, {"$set": {"discordUsername": "{}#123".format(username)}})
        time.sleep(0.1)
    res = post(url + "/public-api/auth-request", post_json={"silent": silent, "username": username}, raw_result=True).json()
    time.sleep(0.1)
    return res


def insert_available_user(public_name=None):
    if public_name is None:
        public_name = _random_string()
    users_collection.insert_one({"publicName": public_name, "available": True})


def get_game_count(token=None):
    if token is None:
        token = get_anon_token()
    return get(url + "/anon-api/games/count", headers={"token": token})["game_count"]


def get_speeds(token=None):
    if token is None:
        token = get_anon_token()
    return get(url + "/anon-api/speeds", headers={"token": token})


def get_client_versions(admin_token):
    return get(url + "/admin-api/users/client_versions", headers={"token": admin_token})


def get_user_count(token=None):
    if token is None:
        token = get_anon_token()
    return get(url + "/anon-api/users/count", headers={"token": token})["unique_user_count"]


def get_all_games_admin_page(admin_token, page, per_page):
    all_games_url = url + "/admin-api/games?page={}&per_page={}".format(page, per_page)
    return get(all_games_url, headers={"token": admin_token})


def get_user_games_admin(user, admin_token, page=1, per_page=10):
    admin_games_url = url + "/admin-api/games/user/{}?page={}&per_page={}".format(user, page, per_page)
    return get(admin_games_url, headers={"token": admin_token})


def get_user_id_games(user_id, admin_token, page=1, per_page=10):
    admin_games_url = url + "/admin-api/games/userID/{}?page={}&per_page={}".format(user_id, page, per_page)
    return get(admin_games_url, headers={"token": admin_token})


def get_game_by_id(game_id, token, raw_result=False):
    game_id_url = url + "/api/game/gameID/{}".format(game_id)
    return get(game_id_url, headers={"token": token}, raw_result=raw_result)


def get_game_by_oid(game_oid, token, raw_result=False):
    oid_url = url + "/api/game/_id/{}".format(game_oid)
    return get(oid_url, headers={"token": token}, raw_result=raw_result)


@pytest.fixture
def empty_game_collection():
    games_collection.drop()


@pytest.fixture
def empty_user_collection():
    users_collection.drop()

@pytest.fixture
def admin_token():
    insert_taken_user("Spencatro", "Tracker_Admin", discord_username="Spencatro#1234554321")
    return get_user_token("Spencatro")


@pytest.fixture
def new_entry_base(empty_game_collection, admin_token):
    post_random_games(num_games=5, admin_token=admin_token)
    time.sleep(1)


@pytest.fixture
def any_games_5_or_more(admin_token):
    anon_key = get_anon_token()
    games = get_game_count(anon_key)
    if games < 5:
        post_random_games(num_games=5, admin_token=admin_token)


def test_games_count(new_entry_base):
    anon_token = get_anon_token()
    game_count = get_game_count(anon_token)
    _game, _post = post_random_game(token=anon_token)
    new_game_count = get_game_count(anon_token)
    assert new_game_count == game_count + 1


def test_speeds(empty_game_collection, admin_token):
    anon_token = get_anon_token()
    speeds = get_speeds(anon_token)
    pprint.pprint(speeds)
    assert speeds["game_speed_per_day"] == 0
    assert speeds["hero_speed_per_day"] == 0

    post_random_games(num_games=7, admin_token=admin_token)
    time.sleep(1)
    speeds = get_speeds(anon_token)
    pprint.pprint(speeds)
    assert 0.9 < speeds["game_speed_per_day"] < 1.1
    assert (1.0 / 8.0) < speeds["hero_speed_per_day"] < (1.0 / 6.0)

    assert 0 < speeds["download_speed_per_day"] < 1000


def test_user_client_versions(empty_game_collection, admin_token):
    clients = get_client_versions(admin_token)
    assert not clients['counts']
    _game, _post = post_random_game(game_shell=_game_shell_schema_0)
    clients = get_client_versions(admin_token)
    assert clients['counts'] == {"none": 1}
    _game, _post = post_random_game(client_version="1.1.0-beta")
    clients = get_client_versions(admin_token)
    assert clients['counts'] == {"none": 1, "1.1.0-beta": 1}
    _game, _post = post_random_game(client_version="1.1.0-beta")
    clients = get_client_versions(admin_token)
    assert clients['counts'] == {"none": 1, "1.1.0-beta": 2}
    _game, _post = post_random_game(client_version="1.2.0-beta")
    clients = get_client_versions(admin_token)
    assert clients['counts'] == {"none": 1, "1.1.0-beta": 2, "1.2.0-beta": 1}

def test_unique_users_count(empty_game_collection):
    original_user_count = get_user_count()
    assert original_user_count == 0
    _game, _post = post_random_game()
    after_posting_one_game_user_count = get_user_count()
    assert after_posting_one_game_user_count == 1
    _game, _post = post_random_game(loser='jenna')
    after_posting_game_with_same_users_user_count = get_user_count()
    assert after_posting_game_with_same_users_user_count == 1
    _game, _post = post_random_game(winner="gemma", loser='jenna')
    after_posting_game_with_new_users_user_count = get_user_count()
    assert after_posting_game_with_new_users_user_count == 2


def test_get_all_games(any_games_5_or_more, admin_token):
    all_id_set = set()
    up_to_2 = get_all_games_admin_page(admin_token, 1, 2)
    assert len(up_to_2["docs"]) == 2
    [all_id_set.add(i["gameID"]) for i in up_to_2["docs"]]

    up_to_4 = get_all_games_admin_page(admin_token, 2, 2)
    assert len(up_to_4["docs"]) == 2
    assert up_to_2 != up_to_4

    [all_id_set.add(i["gameID"]) for i in up_to_4["docs"]]
    assert len(all_id_set) == 4


def test_get_users_games_admin(any_games_5_or_more, admin_token):
    random_user = _random_string()
    user_games = get_user_games_admin(random_user, admin_token)
    assert(len(user_games["docs"]) == 0)
    post_random_game(random_user)
    post_random_game(random_user)
    user_games = get_user_games_admin(random_user, admin_token)
    assert len(user_games["docs"]) == 2

    post_random_game(random_user)
    post_random_game(random_user)
    user_games = get_user_games_admin(random_user, admin_token)
    assert len(user_games["docs"]) == 4
    all_id_set = set()
    up_to_2 = get_user_games_admin(random_user, admin_token, 1, 2)
    assert len(up_to_2["docs"]) == 2
    [all_id_set.add(i["gameID"]) for i in up_to_2["docs"]]
    up_to_4 = get_user_games_admin(random_user, admin_token, 2, 2)
    assert len(up_to_4["docs"]) == 2
    assert up_to_2 != up_to_4
    [all_id_set.add(i["gameID"]) for i in up_to_4["docs"]]
    assert len(all_id_set) == 4


def test_get_users_games_by_user_id_admin(any_games_5_or_more, admin_token):
    random_user_id = _random_string()
    user_games = get_user_id_games(random_user_id, admin_token)
    assert(len(user_games["docs"]) == 0)
    post_random_game(winner_id=random_user_id)
    post_random_game(winner_id=random_user_id)
    user_games = get_user_id_games(random_user_id, admin_token)
    assert len(user_games["docs"]) == 2

    post_random_game(winner_id=random_user_id)
    post_random_game(winner_id=random_user_id)
    user_games = get_user_id_games(random_user_id, admin_token)
    assert len(user_games["docs"]) == 4

    all_id_set = set()
    up_to_2 = get_user_id_games(random_user_id, admin_token, 1, 2)
    assert len(up_to_2["docs"]) == 2
    [all_id_set.add(i["gameID"]) for i in up_to_2["docs"]]
    up_to_4 = get_user_id_games(random_user_id, admin_token, 2, 2)
    assert len(up_to_4["docs"]) == 2
    assert up_to_2 != up_to_4
    [all_id_set.add(i["gameID"]) for i in up_to_4["docs"]]
    assert len(all_id_set) == 4


def test_get_game(empty_game_collection):
    game, res = post_random_game(winner="tess", loser="joey")
    game2, res = post_random_game(winner="joey", loser="nobody")

    game_id = game["gameID"]
    hero_token = get_user_token("tess")
    opponent_token = get_user_token("joey")
    game_by_id_from_hero = get_game_by_id(game_id, hero_token)
    game_by_id_from_oppo = get_game_by_id(game_id, opponent_token, raw_result=True)
    assert game_by_id_from_oppo.status_code == 401
    game_by_oid_from_hero = get_game_by_oid(game_by_id_from_hero["_id"], hero_token)
    game_by_oid_from_oppo = get_game_by_oid(game_by_id_from_hero["_id"], opponent_token, raw_result=True)
    assert game_by_oid_from_oppo.status_code == 401
    assert game_by_oid_from_hero == game_by_id_from_hero


def test_post_game(any_games_5_or_more):
    anon_token = get_anon_token()
    game_count = get_game_count(token=anon_token)
    post_random_game(token=anon_token)
    game_count_after = get_game_count(anon_token)
    assert game_count_after == game_count + 1
    post_bad_game(missing_winner_name=True)
    game_count_after = get_game_count(anon_token)
    assert game_count_after == game_count + 1
    post_bad_game(missing_winner_name=False, missing_loser_name=True)
    game_count_after = get_game_count(anon_token)
    assert game_count_after == game_count + 1
    post_bad_game(missing_winner_name=False, missing_winning_deck=True)
    game_count_after = get_game_count(anon_token)
    assert game_count_after == game_count + 1
    post_bad_game(missing_winner_name=False, missing_losing_deck=True)
    game_count_after = get_game_count(anon_token)
    assert game_count_after == game_count + 1
    post_bad_game(missing_winner_name=False, missing_winner_user_id=True)
    game_count_after = get_game_count(anon_token)
    assert game_count_after == game_count + 1
    post_bad_game(missing_winner_name=False, missing_loser_user_id=True)
    game_count_after = get_game_count(anon_token)
    assert game_count_after == game_count + 1
    post_bad_game(missing_winner_name=False, no_winner_defined=True)
    game_count_after = get_game_count(anon_token)
    assert game_count_after == game_count + 1
    post_bad_game(missing_winner_name=False, missing_game_id=True)
    game_count_after = get_game_count(anon_token)
    assert game_count_after == game_count + 1
    post_bad_game(missing_winner_name=False, players_undefined=True)
    game_count_after = get_game_count(anon_token)
    assert game_count_after == game_count + 1
    post_bad_game(missing_winner_name=False, players_not_list=True)
    game_count_after = get_game_count(anon_token)
    assert game_count_after == game_count + 1
    post_bad_game(missing_winner_name=False, players_empty=True)
    game_count_after = get_game_count(anon_token)
    assert game_count_after == game_count + 1


def test_post_game_without_hero_gets_hero(empty_user_collection):
    posted_game, result = post_random_game(game_shell=_game_shell_schema_0)
    assert "hero" not in posted_game.keys()
    post_random_game()  # unlock account

    game_id = posted_game["gameID"]
    hero_token = get_user_token("joe")
    game_by_id = get_game_by_id(game_id, hero_token)
    assert "hero" in game_by_id.keys()
    for player in game_by_id["players"]:
        if player["name"] == game_by_id["hero"]:
            assert "visible cards" not in player["deck"]["poolName"]
        else:
            assert "visible cards" in player["deck"]["poolName"]


@pytest.mark.dev
def test_clientversion_ok(empty_user_collection, any_games_5_or_more):
    posted_game, result = post_random_game(client_version=latest_client_version, game_shell=_game_shell_schema_1_1_0_beta)
    assert "clientVersionOK" not in posted_game.keys()
    game_id = posted_game["gameID"]
    hero_token = get_user_token(posted_game["hero"])
    game_by_id = get_game_by_id(game_id, hero_token)
    assert "clientVersionOK" in game_by_id.keys() and game_by_id["clientVersionOK"]

    newer_major_version = "9" + latest_client_version[1:]
    posted_game, result = post_random_game(client_version=newer_major_version, game_shell=_game_shell_schema_1_1_0_beta)
    assert "clientVersionOK" not in posted_game.keys()
    game_id = posted_game["gameID"]
    hero_token = get_user_token(posted_game["hero"])
    game_by_id = get_game_by_id(game_id, hero_token)
    assert "clientVersionOK" in game_by_id.keys() and game_by_id["clientVersionOK"]

    newer_medium_version = latest_client_version[:2] + "9" + latest_client_version[3:]
    posted_game, result = post_random_game(client_version=newer_medium_version, game_shell=_game_shell_schema_1_1_0_beta)
    assert "clientVersionOK" not in posted_game.keys()
    game_id = posted_game["gameID"]
    hero_token = get_user_token(posted_game["hero"])
    game_by_id = get_game_by_id(game_id, hero_token)
    assert "clientVersionOK" in game_by_id.keys() and game_by_id["clientVersionOK"]

    posted_game, result = post_random_game(client_version="0.0.0-alpha", game_shell=_game_shell_schema_1_1_0_beta)
    assert "clientVersionOK" not in posted_game.keys()
    game_id = posted_game["gameID"]
    hero_token = get_user_token(posted_game["hero"])
    post_random_game()  # unlock account
    game_by_id = get_game_by_id(game_id, hero_token)
    assert "clientVersionOK" in game_by_id.keys() and not game_by_id["clientVersionOK"]

    posted_game, result = post_random_game(client_version="1.0.0", game_shell=_game_shell_schema_1_1_0_beta)
    assert "clientVersionOK" not in posted_game.keys()
    game_id = posted_game["gameID"]
    hero_token = get_user_token(posted_game["hero"])
    post_random_game()  # unlock account
    game_by_id = get_game_by_id(game_id, hero_token)
    assert "clientVersionOK" in game_by_id.keys() and not game_by_id["clientVersionOK"]

    posted_game, result = post_random_game(client_version=None, game_shell=_game_shell_schema_0)
    assert "clientVersionOK" not in posted_game.keys() and "client_version" not in posted_game.keys()
    post_random_game()  # unlock account
    game_id = posted_game["gameID"]
    hero_token = get_user_token("joe")
    game_by_id = get_game_by_id(game_id, hero_token)
    assert "clientVersionOK" in game_by_id.keys() and not game_by_id["clientVersionOK"]


@pytest.mark.slow
def test_gh_cache(admin_token):
    token = get_anon_token()
    stat_cache = get(url + "/anon-api/gh-stat-cache", headers={"token": token})
    time.sleep(1)
    stat_cache_immediate = get(url + "/anon-api/gh-stat-cache", headers={"token": token})
    assert stat_cache_immediate["lastUpdated"] == stat_cache["lastUpdated"]
    time.sleep(1)
    delete(url + "/admin-api/gh-stat-cache", headers={"token": admin_token})
    time.sleep(1)
    stat_cache_after_delete = get(url + "/anon-api/gh-stat-cache", headers={"token": token})
    assert stat_cache_after_delete["lastUpdated"] != stat_cache_immediate["lastUpdated"]
    time.sleep(120)
    stat_cache_after_wait = get(url + "/anon-api/gh-stat-cache", headers={"token": token})
    assert stat_cache_after_wait["lastUpdated"] != stat_cache_after_delete["lastUpdated"]


def test_post_games(any_games_5_or_more, admin_token):
    game_count = get_game_count(admin_token)
    post_random_games(admin_token=admin_token)
    time.sleep(1)
    game_count_after = get_game_count(admin_token)
    assert game_count_after == game_count + 3


def test_post_tons_of_new_games(any_games_5_or_more, admin_token):
    game_count = get_game_count(admin_token)
    two_hundred_random_games = [copy.deepcopy(_game_shell_schema_0) for _ in range(200)]
    for game in two_hundred_random_games:
        game["gameID"] = _random_string()
    post_random_games(two_hundred_random_games, admin_token=admin_token)
    time.sleep(0.5)  # give a hair of recovery time
    game_count_after_200 = get_game_count(admin_token)
    assert game_count_after_200 == game_count + 200


def test_post_games_with_duplicate_ids(any_games_5_or_more, admin_token):
    game_count = get_game_count()
    six_games_five_duplicates = [copy.deepcopy(_game_shell_schema_0) for _ in range(6)]
    same_string = _random_string()
    for game in six_games_five_duplicates:
        game["gameID"] = same_string
    six_games_five_duplicates[0]["gameID"] = _random_string()
    post_random_games(six_games_five_duplicates, admin_token=admin_token)
    game_count_after_2 = get_game_count()
    assert game_count_after_2 == game_count + 2

    game_count = game_count_after_2
    post_random_games(six_games_five_duplicates, admin_token=admin_token)
    game_count_after_posting_all_duplicates = get_game_count()
    assert game_count_after_posting_all_duplicates == game_count


def test_get_publicname(empty_game_collection, empty_user_collection, admin_token):
    username = "bobby"
    pubname = "Frilled_Merfolk"
    res_before_insert = get(url + "/admin-api/publicName/{}".format(username), raw_result=True, headers={"token": admin_token})
    assert res_before_insert.status_code == 404
    insert_taken_user(username, pubname)
    res_after = get(url + "/admin-api/publicName/{}".format(username), headers={"token": admin_token})
    assert res_after["username"] == username
    assert res_after["publicName"] == pubname


def test_publicname_chosen_if_available(empty_game_collection, empty_user_collection, admin_token):
    insert_available_user("testpubname1")
    insert_available_user("testpubname2")

    game, _ = post_random_game()
    public_name_url = url + "/admin-api/publicName/{}".format(game["players"][0]["name"])
    user1_back = get(public_name_url, headers={"token": admin_token})
    assert user1_back['publicName'] in ["testpubname1", "testpubname2"]
    assert user1_back['available'] is False

    public_name_url = url + "/admin-api/publicName/{}".format(game["players"][1]["name"])
    user2_back = get(public_name_url, headers={"token": admin_token})
    assert user2_back['publicName'] in ["testpubname1", "testpubname2"]
    assert user2_back['available'] is False

    assert user1_back['publicName'] != user2_back['publicName']


def test_publicname_generated_if_none_available(empty_game_collection, empty_user_collection, admin_token):
    game, _ = post_random_game()
    public_name_url = url + "/admin-api/publicName/{}".format(game["players"][0]["name"])
    user1_back = get(public_name_url, headers={"token": admin_token})
    assert user1_back['publicName']
    assert user1_back['available'] is False

    public_name_url = url + "/admin-api/publicName/{}".format(game["players"][1]["name"])
    user2_back = get(public_name_url, headers={"token": admin_token})
    assert user2_back['publicName']
    assert user2_back['available'] is False

    assert user1_back['publicName'] != user2_back['publicName']


def test_users_dont_get_overwritten_when_opponents(empty_game_collection, empty_user_collection, admin_token):
    game, _ = post_random_game(winner="trish", loser="james")  # trish is the user, james is not
    game, _ = post_random_game(winner="kate", loser="james")  # kate is the user, james is not
    game, _ = post_random_game(winner="joey", loser="trish")  # kate is the user, james is not

    trish_url = url + "/admin-api/publicName/{}".format("trish")
    trish_back = get(trish_url, headers={"token": admin_token})
    assert trish_back['isUser']

    joey_url = url + "/admin-api/publicName/{}".format("joey")
    joey_back = get(joey_url,  headers={"token": admin_token})
    assert joey_back['isUser']


def test_users_update_if_theyre_heroes_now_but_theyve_been_opponents_before(empty_game_collection, empty_user_collection, admin_token):
    game, _ = post_random_game(winner="trish", loser="james")  # trish is the user, james is not
    game, _ = post_random_game(winner="kate", loser="james")  # kate is the user, james is not
    game, _ = post_random_game(winner="james", loser="trish")  # kate is the user, james is not

    trish_url = url + "/admin-api/publicName/{}".format("trish")
    trish_back = get(trish_url, headers={"token": admin_token})
    assert trish_back['isUser']

    kate_url = url + "/admin-api/publicName/{}".format("kate")
    kate_back = get(kate_url, headers={"token": admin_token})
    assert kate_back['isUser']

    james_url = url + "/admin-api/publicName/{}".format("james")
    james_back = get(james_url, headers={"token": admin_token})
    assert james_back['isUser']


def test_users_are_resilient(empty_game_collection, empty_user_collection, admin_token):
    game, _ = post_random_game(winner="trish", loser="james")  # trish is the user, james is not
    og_trish_public_name = get(url + "/admin-api/publicName/{}".format("trish"), headers={"token": admin_token})
    og_james_public_name = get(url + "/admin-api/publicName/{}".format("james"), headers={"token": admin_token})

    game, _ = post_random_game(winner="kate", loser="james")
    game, _ = post_random_game(winner="james", loser="joey")
    game, _ = post_random_game(winner="james", loser="joey")
    game, _ = post_random_game(winner="james", loser="kate")
    game, _ = post_random_game(winner="james", loser="trish")
    game, _ = post_random_game(winner="trish", loser="james")

    trish_back = get(url + "/admin-api/publicName/{}".format("trish"), headers={"token": admin_token})
    assert trish_back == og_trish_public_name

    james_back = get(url + "/admin-api/publicName/{}".format("james"), headers={"token": admin_token})
    assert james_back["isUser"]
    assert not og_james_public_name["isUser"]
    del og_james_public_name["isUser"]
    del james_back["isUser"]  # these will be different at end, deleted them for easier comparison
    assert james_back == og_james_public_name


def test_duplicate_games_dont_make_duplicate_users(empty_game_collection, empty_user_collection):
    game, _ = post_random_game(winner="kate", loser="james")
    game, _ = post_random_game(winner="james", loser="kate")
    game, _ = post_random_game(winner="kate", loser="james")
    game, _ = post_random_game(winner="james", loser="kate")
    game, _ = post_random_game(winner="kate", loser="james")
    game, _ = post_random_game(winner="james", loser="kate")
    game, _ = post_random_game(winner="kate", loser="james")
    game, _ = post_random_game(winner="james", loser="kate")
    game, _ = post_random_game(winner="james", loser="trish")
    game, _ = post_random_game(winner="trish", loser="james")
    game, _ = post_random_game(winner="trish", loser="kate")
    game, _ = post_random_game(winner="kate", loser="trish")
    assert users_collection.count() == 3


def test_404():
    result = get(url + "/its-bananas", True)
    assert result.status_code == 404
    assert "may be banned" in str(result.json())
    result = get(url + "/its/bananas/b-a-n-a-n-a-s", True)
    assert result.status_code == 404
    assert "may be banned" in str(result.json())


@pytest.mark.auth
def test_auth_request(empty_game_collection, empty_user_collection):
    game, _ = post_random_game(winner="kate", loser="james")

    # test no discord mapping -> no token
    request_auth("kate")
    time.sleep(0.5)
    user_after_auth_request = users_collection.find_one({"username": "kate"})
    assert "auth" not in user_after_auth_request.keys()

    # test with discord mapping -> token
    request_auth("kate", force_discord=True)
    time.sleep(0.5)
    user_after_auth_request = users_collection.find_one({"username": "kate"})

    kate_after = users_collection.find_one({"username": "kate"})
    assert "auth" in kate_after.keys()

    access_code = int(kate_after["auth"]["accessCode"])
    assert 0 < access_code < 999999


@pytest.mark.auth
def test_auth_request_case_insensitive(empty_game_collection, empty_user_collection):
    insert_taken_user("kate", discord_username="kate#123123123123")
    request_auth("kAtE")
    kate_after = users_collection.find_one({"username": "kate"})
    assert "auth" in kate_after.keys()


@pytest.mark.slow
@pytest.mark.auth
def test_auth_request_expires(empty_game_collection, empty_user_collection):
    # TODO: dry here and test_auth_request
    game, _ = post_random_game(winner="kate", loser="james")
    kate_before = users_collection.find_one({"username": "kate"})
    assert "auth" not in kate_before.keys()

    request_auth("kate", force_discord=True)
    kate_after = users_collection.find_one({"username": "kate"})
    assert "auth" in kate_after.keys()

    access_code = int(kate_after["auth"]["accessCode"])
    assert 0 < access_code < 999999

    request_auth("kate")
    kate_after_2 = users_collection.find_one({"username": "kate"})
    access_code_after = int(kate_after_2["auth"]["accessCode"])
    assert access_code == access_code_after

    time.sleep(30)
    request_auth("kate")
    kate_after_30s = users_collection.find_one({"username": "kate"})
    access_code_after30s = int(kate_after_30s["auth"]["accessCode"])
    assert access_code == access_code_after30s

    time.sleep(70)  # 70 + 30 = 100 > 90, so code should roll
    request_auth("kate")
    kate_after_100s = users_collection.find_one({"username": "kate"})
    access_code_after100s = int(kate_after_100s["auth"]["accessCode"])
    assert access_code != access_code_after100s


@pytest.mark.token
@pytest.mark.auth
def test_anon_api_not_accessible_without_token():
    anon_api_no_token = get(url + "/anon-api/", raw_result=True)
    assert anon_api_no_token.status_code == 401


@pytest.mark.token
@pytest.mark.auth
def test_admin_api_not_accessible_without_token():
    anon_api_no_token = get(url + "/admin-api/", raw_result=True)
    assert anon_api_no_token.status_code == 401


@pytest.mark.token
@pytest.mark.auth
def test_user_api_not_accessible_without_token():
    anon_api_no_token = get(url + "/api/", raw_result=True)
    assert anon_api_no_token.status_code == 401


@pytest.mark.token
@pytest.mark.auth
def test_get_anon_token(empty_game_collection):
    anon_token = get_anon_token()
    token_decoded = jwt.decode(anon_token, verify=False)  # we don't have the secret, can only inspect the payload
    assert token_decoded["user"] is None
    assert 0 < token_decoded["anonymousClientID"] <= 999999
    plus_48h = datetime.datetime.now() + datetime.timedelta(hours=48)
    token_exp = datetime.datetime.fromtimestamp(token_decoded["exp"])
    assert token_exp < plus_48h
    anon_api_token = get(url + "/anon-api/", headers={"token": anon_token}, raw_result=True)
    assert anon_api_token.status_code == 200


@pytest.mark.token
@pytest.mark.auth
def test_get_user_token(empty_game_collection, empty_user_collection):
    game, _ = post_random_game(winner="kate", loser="james")
    user_token = get_user_token("kate")
    token_decoded = jwt.decode(user_token, verify=False)  # we don't have the secret, can only inspect the payload
    assert token_decoded["user"] == "kate"
    plus_192h = datetime.datetime.now() + datetime.timedelta(hours=192)  # 8 days
    token_exp = datetime.datetime.fromtimestamp(token_decoded["exp"])
    assert token_exp < plus_192h
    anon_api_token = get(url + "/api/", headers={"token": user_token}, raw_result=True)
    assert anon_api_token.status_code == 200


@pytest.mark.token
@pytest.mark.auth
def test_get_user_games(empty_game_collection):
    post_random_game(winner="gemma")
    gemma_token = get_user_token("gemma")
    games = get(url + "/api/games", headers={"token": gemma_token})
    print(games)
    for game in games["docs"]:
        print(game)
        assert game["hero"] == "gemma"

    post_random_game(winner="gemma")
    post_random_game(winner="gemma")
    post_random_game(winner="jane")
    post_random_game(winner="gemma")
    post_random_game(winner="jane")
    post_random_game(winner="gemma")

    games = get(url + "/api/games", headers={"token": gemma_token})
    print(games)
    for game in games["docs"]:
        print(game)
        assert game["hero"] == "gemma"


@pytest.mark.token
@pytest.mark.auth
def test_get_user_games_hides_games_oldversions(empty_game_collection):
    post_random_game(winner="gemma")
    gemma_token = get_user_token("gemma")
    games = get(url + "/api/games", headers={"token": gemma_token})
    for game in games["docs"]:
        assert game["hero"] == "gemma"

    post_random_game(winner="gemma", client_version="0.0.0-beta")
    games = get(url + "/api/games", headers={"token": gemma_token})
    assert "locked" in games["error"]

    post_random_game(winner="gemma")
    games = get(url + "/api/games", headers={"token": gemma_token})
    for game in games["docs"]:
        assert game["hero"] == "gemma"


@pytest.mark.token
@pytest.mark.auth
def test_get_user_decks(empty_game_collection):
    post_random_game(winner="gemma")
    gemma_token = get_user_token("gemma")
    games = get(url + "/api/decks", headers={"token": gemma_token})

    assert games["123-joe-456"]["losses"] == 0
    assert games["123-joe-456"]["wins"] == 1

    post_random_game(winner="gemma", winner_deck_id="123-456-789")
    time.sleep(1)
    games = get(url + "/api/decks", headers={"token": gemma_token})

    assert games["123-joe-456"]["losses"] == 0
    assert games["123-joe-456"]["wins"] == 1
    assert games["123-456-789"]["losses"] == 0
    assert games["123-456-789"]["wins"] == 1

    post_random_game(winner="gemma", winner_deck_id="123-456-789")
    time.sleep(1)
    games = get(url + "/api/decks", headers={"token": gemma_token})

    assert games["123-joe-456"]["losses"] == 0
    assert games["123-joe-456"]["wins"] == 1
    assert games["123-456-789"]["losses"] == 0
    assert games["123-456-789"]["wins"] == 2

    post_random_game(hero="gemma", loser="gemma", winner="joe")
    time.sleep(1)
    games = get(url + "/api/decks", headers={"token": gemma_token})

    assert games["123-joe-456"]["losses"] == 1
    assert games["123-joe-456"]["wins"] == 1
    assert games["123-456-789"]["losses"] == 0
    assert games["123-456-789"]["wins"] == 2


@pytest.mark.token
@pytest.mark.auth
def test_hide_deck_in_inspector(empty_game_collection, empty_user_collection):
    post_random_game(winner="gemma")
    gemma_token = get_user_token("gemma")
    games_before = get(url + "/api/decks", headers={"token": gemma_token})
    deck_to_hide = "hidemepls"
    assert deck_to_hide not in games_before.keys()
    posted_game, result = post_random_game(winner="gemma", game_shell=_game_shell_schema_1_1_1_beta, winner_deck_id=deck_to_hide)
    games_after_post = get(url + "/api/decks", headers={"token": gemma_token})
    assert deck_to_hide in games_after_post.keys()
    hide_deck(deck_to_hide, gemma_token)
    games_after_hide = get(url + "/api/decks", headers={"token": gemma_token})
    games_after_hide_include_hidden = get(url + "/api/decks?includeHidden=true", headers={"token": gemma_token})
    assert deck_to_hide in games_after_hide_include_hidden.keys()
    assert deck_to_hide not in games_after_hide.keys()

    # make sure we can bring it back
    unhide_deck(deck_to_hide, gemma_token)
    games_after_unhide = get(url + "/api/decks", headers={"token": gemma_token})
    games_after_unhide_include_hidden = get(url + "/api/decks?includeHidden=true", headers={"token": gemma_token})
    assert deck_to_hide in games_after_unhide_include_hidden.keys()
    assert deck_to_hide in games_after_unhide.keys()


@pytest.mark.token
@pytest.mark.auth
def test_get_user_games_for_deck(empty_game_collection):
    specific_deck_ID = "search_deck_id"
    post_random_game(winner="gemma", winner_deck_id=specific_deck_ID)
    gemma_token = get_user_token("gemma")
    games = get(url + "/api/games?deckID={}".format(specific_deck_ID), headers={"token": gemma_token})
    for game in games["docs"]:
        assert game["hero"] == "gemma"
        assert game["players"][0]["deck"]["deckID"] == specific_deck_ID

    post_random_game(winner="gemma", winner_deck_id="search_deck_id")
    post_random_game(winner="gemma")
    post_random_game(winner="notgemma")
    post_random_game(winner="notgemma", winner_deck_id="search_deck_id")  # this should never happen, but still
    post_random_game(winner="gemma", winner_deck_id="search_deck_id")
    post_random_game(winner="gemma")

    games = get(url + "/api/games?deckID={}".format(specific_deck_ID), headers={"token": gemma_token})
    assert len(games["docs"]) == 3
    for game in games["docs"]:
        assert game["hero"] == "gemma"
        assert game["players"][0]["deck"]["deckID"] == specific_deck_ID


@pytest.mark.token
@pytest.mark.auth
def test_get_user_games_against_opponent(empty_game_collection):
    specific_opponent = "antigemma"
    post_random_game(winner="gemma", hero="gemma", opponent=specific_opponent)
    gemma_token = get_user_token("gemma")
    games = get(url + "/api/games?opponent={}".format(specific_opponent), headers={"token": gemma_token})
    for game in games["docs"]:
        assert game["hero"] == "gemma"
        assert game["opponent"] == specific_opponent

    post_random_game(winner="gemma", hero="gemma", opponent=specific_opponent)
    post_random_game(winner="gemma", hero="gemma")
    post_random_game(winner="notgemma")
    post_random_game(winner="notgemma", opponent=specific_opponent)  # this should never happen, but still
    post_random_game(winner="gemma", hero="gemma", opponent=specific_opponent)
    post_random_game(winner="gemma", hero="gemma")

    games = get(url + "/api/games?opponent={}".format(specific_opponent), headers={"token": gemma_token})
    assert len(games["docs"]) == 3
    for game in games["docs"]:
        assert game["hero"] == "gemma"
        assert game["opponent"] == specific_opponent


def test_game_histogram_one_per(empty_game_collection, admin_token):
    _20_days_ago = datetime.datetime.now() - datetime.timedelta(days=20)
    twenty_random_games = [copy.deepcopy(_game_shell_schema_1_1_1_beta) for _ in range(20)]
    for idx, game in enumerate(twenty_random_games):
        game["gameID"] = _random_string()
        game["date"] = str(_20_days_ago + datetime.timedelta(days=idx))
    post_random_games(twenty_random_games, admin_token=admin_token)
    time.sleep(3)

    gh_url = url + "/anon-api/games/time-histogram"
    histo = get(gh_url, headers={"token": admin_token})["game_histogram"]
    current_count = 0
    assert 5 < len(histo) < 8  # should have 6-7entries; 6-7 games over the last week, 20 over the last 20 days
    for item in sorted(histo, key=lambda x: parse_date(x["date"])):
        next_count = item["count"]
        if current_count == 0:
            assert next_count > current_count
        else:
            assert next_count == current_count + 1
        current_count = next_count


def test_game_histogram_one_per_(empty_game_collection, admin_token):
    _20_days_ago = datetime.datetime.now() - datetime.timedelta(days=20)
    two_hundred_random_games = [copy.deepcopy(_game_shell_schema_1_1_1_beta) for _ in range(200)]
    for idx, game in enumerate(two_hundred_random_games):
        game["gameID"] = _random_string()
        game["date"] = str(_20_days_ago + datetime.timedelta(days=int(idx / 10)))
    post_random_games(two_hundred_random_games, admin_token=admin_token)
    gh_url = url + "/anon-api/games/time-histogram"
    histo = get(gh_url, headers={"token": admin_token})["game_histogram"]
    assert 59 < len(histo) < 61  # should have 60 entries; 60 games over the last week, 200 over the last 20 days
    current_count = 0
    for item in sorted(histo, key=lambda x: parse_date(x["date"])):
        next_count = item["count"]
        if current_count == 0:
            assert next_count > current_count
        else:
            assert next_count == current_count + 1
        current_count = next_count


def test_game_histogram_many_per(empty_game_collection, admin_token):
    _20_days_ago = datetime.datetime.now() - datetime.timedelta(days=20)
    for i in range(10):
        two_hundred_random_games = [copy.deepcopy(_game_shell_schema_1_1_1_beta) for _ in range(200)]
        for idx, game in enumerate(two_hundred_random_games):
            game["gameID"] = _random_string()
            game["date"] = str(_20_days_ago + datetime.timedelta(days=int(idx / 10)))
        post_random_games(two_hundred_random_games, admin_token=admin_token)

    gh_url = url + "/anon-api/games/time-histogram"
    histo = get(gh_url, headers={"token": admin_token})["game_histogram"]
    pprint.pprint(histo)
    assert 99 < len(histo) < 102  # should hit the max resolution here, fuzzy 100
    current_count = 0
    for item in sorted(histo, key=lambda x: parse_date(x["date"])):
        next_count = item["count"]
        if current_count == 0:
            assert next_count > current_count
        else:
            assert current_count + 5 < next_count < current_count + 8 or next_count == 2000
        current_count = next_count


def test_hero_histogram_one_per(empty_game_collection, admin_token):
    _20_days_ago = datetime.datetime.now() - datetime.timedelta(days=20)
    twenty_random_games = [copy.deepcopy(_game_shell_schema_1_1_1_beta) for _ in range(20)]
    last_hero_added = None
    for idx, game in enumerate(twenty_random_games):
        game["gameID"] = _random_string()
        game["hero"] = game["hero"] + str(idx)
        game["winner"] = game["hero"]
        game["players"][0]["name"] = game["hero"]
        game["date"] = str(_20_days_ago + datetime.timedelta(days=idx))
        last_hero_added = game["hero"]
    post_random_games(twenty_random_games, admin_token=admin_token)
    time.sleep(3)

    gh_url = url + "/anon-api/heroes/time-histogram"
    histo_result = get(gh_url, headers={"token": admin_token})
    histo = histo_result["hero_histogram"]

    current_count = 0
    assert 5 < len(histo) < 8  # should have 6-7entries; 6-7 games over the last week, 20 over the last 20 days
    for item in sorted(histo, key=lambda x: parse_date(x["date"])):
        next_count = item["count"]
        if current_count == 0:
            assert next_count > current_count
        else:
            assert next_count == current_count + 1
        current_count = next_count

    post_random_game(winner=last_hero_added)
    gh_url = url + "/anon-api/heroes/time-histogram"
    histo_result_2 = get(gh_url, headers={"token": admin_token})

    twenty_random_games = [copy.deepcopy(_game_shell_schema_1_1_1_beta) for _ in range(20)]
    for idx, game in enumerate(twenty_random_games):
        game["gameID"] = _random_string()
        game["hero"] = last_hero_added
        game["winner"] = game["hero"]
        game["players"][0]["name"] = game["hero"]
        game["date"] = str(_20_days_ago + datetime.timedelta(days=idx))
    post_random_games(twenty_random_games, admin_token=admin_token)

    gh_url = url + "/anon-api/heroes/time-histogram"
    histo_result_3 = get(gh_url, headers={"token": admin_token})

    twenty_random_games = [copy.deepcopy(_game_shell_schema_1_1_1_beta) for _ in range(20)]
    for idx, game in enumerate(twenty_random_games):
        game["gameID"] = _random_string()
        game["hero"] = game["hero"] + str(idx)
        game["winner"] = game["hero"]
        game["players"][0]["name"] = game["hero"]
        game["date"] = str(_20_days_ago + datetime.timedelta(days=idx))
    post_random_games(twenty_random_games, admin_token=admin_token)

    gh_url = url + "/anon-api/heroes/time-histogram"
    histo_result_4 = get(gh_url, headers={"token": admin_token})

    # make sure that the count is always 20
    assert max(histo_result["hero_histogram"], key=lambda x: x["count"])["count"] == max(histo_result_2["hero_histogram"], key=lambda x: x["count"])["count"]
    assert max(histo_result["hero_histogram"], key=lambda x: x["count"])["count"] == max(histo_result_3["hero_histogram"], key=lambda x: x["count"])["count"]
    assert max(histo_result["hero_histogram"], key=lambda x: x["count"])["count"] == max(histo_result_4["hero_histogram"], key=lambda x: x["count"])["count"]


if __name__ == "__main__":
    sys.exit(pytest.main(['--html', 'pytest_report.html'] + sys.argv[1:]))
