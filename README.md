# MTGATracker Webtask

MTGATracker Webtask is the repo that contains the code that runs the API serving MTGATracker and MTGATracker: Inspector.

MTGATracker Webtask is hosted on the [Auth0 Extend](https://goextend.io) platform as a serverless application.

## Getting started

- Install the [webtask cli](https://github.com/auth0/wt-cli). All following instructions assume you are in
the `on_demand` directory.
- `cp secrets.js.template secrets.js` to get a functional (but blank) `secrets.js` file. If you are deploying
a production version of the API, ensure you are using a cryptographically strong secret.

(WIP/YMMV) To host the webtask locally, try `serve_locally.sh` in the `on_demand` directory. Note that many
environment variables must be set beforehand.

To deploy, you'll need local copies of many secrets (`secret-host`, `secret-name`, etc). If you have these,
you can deploy to goextend with `deploy_prod_1.sh` or `deploy_prod_2.sh` in the `on_demand` directory.