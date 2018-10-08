#!/usr/bin/env bash

wt_dirty=""
if [[ $(git diff --stat) != '' ]]; then
  wt_dirty='-dirty'
fi
wt_version=$(git log --pretty=format:"%aD: %s - %h" | head -n 1)$wt_dirty


wt_secret=$(cat secret-name)
wt_host="gx4.mtgatracker.com"
wt create . --bundle --bundle-minify --host="$wt_host" --secret version="$wt_version" --name="mtgatracker-prod-$wt_secret" --secrets-file=secrets3_db_secondary --watch --profile gx4