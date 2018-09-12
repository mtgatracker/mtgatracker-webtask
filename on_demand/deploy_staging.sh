#!/usr/bin/env bash
wt create . --bundle --bundle-minify --secrets-file=secrets --secret version="staging" --name=mtga-tracker-game-dev --watch --profile goextend_dev
