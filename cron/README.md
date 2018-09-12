# This directory is deprecated!

This directory contains code that basically corrected incorrect data on a schedule, so that we could
start fixing old data before implementing a fix for some issue.
In case we ever need cron jobs again (hopefully not), this can be used as a reference. However, in general 
in the future we should follow the implementation flow of:
- Prepare API to do the right thing; deploy
- THEN fix old records