#!/bin/bash
set -e

TODAY=$(date -v0H -v0M -v0S +%s)
YESTERDAY=$(date -v-1d -v0H -v0M -v0S +%s)

ssh optiplex "ls ~/globular-adsb/archive/*.json 2>/dev/null | xargs -n1 basename | sed 's/\.json//' | awk -v lo=$YESTERDAY -v hi=$TODAY '\$1 >= lo && \$1 < hi {print \$1\".json\"}'" | \
  rsync -av --files-from=- optiplex:~/globular-adsb/archive/ archive/
