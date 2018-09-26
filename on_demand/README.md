## Provisioning more containers (gx1, gx2, etc)

Naming conventions (preferred, but not required):
- Subdomain should be provider abbrev. (goextend => gx) and instance number (=> gx3)
- Container suffix should be p for production, d for dev, or something else, plus instance number (=> p3)

For this exercise, we'll create **gx3** , a third potential production webtask instance.

1. Create a new wt-cli profile:

```bash
# url is always https://starter.auth0-extend.com
# container is always str-85b6a06b2d213fac515a8ba7b582387a-SOMETHING , where SOMETHING is arbitrary
wt profile init --profile gx3 --url https://starter.auth0-extend.com --container str-85b6a06b2d213fac515a8ba7b582387a-p3 --token TOKEN
```

2. Deploy something to the webtask (and set up deploy scripts for the future)

```bash
cp deploy_prod_2.sh deploy_prod_3.sh
echo "gx3.mtgatracker.com" > secret-host3
vim deploy_prod_3.sh
# EDIT deploy_prod_3.sh : wt-host should look at secret-host3, --profile should use gx3
sh deploy_prod_3.sh
```

3. Set up custom domain rules
3.1 Go to cloudflare > mtgatracker > DNS
3.2 Make a new CNAME record:

**Name** gx3
**value** is an alias of str-85b6a06b2d213fac515a8ba7b582387a-p3.starter.auth0-extend.com

3.3 Make a new TXT record (required for webtask custom domains):

**Name** gx3
**Value** webtask:container:str-85b6a06b2d213fac515a8ba7b582387a-p3

4. Check if all worked:

https://gx3.mtgatracker.com/str-85b6a06b2d213fac515a8ba7b582387a-p3/mtgatracker-prod-EhDvLyq7PNb/
