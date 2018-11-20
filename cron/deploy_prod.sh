#!/usr/bin/env bash
wt cron create --bundle --bundle-minify --secrets-file=secrets3 --profile gx3 --watch --schedule="10min" .
