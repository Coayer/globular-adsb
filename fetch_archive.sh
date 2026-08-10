#!/bin/bash
set -e

ROLLING=0
for arg in "$@"; do
  case "$arg" in
    --rolling|-r) ROLLING=1 ;;
  esac
done

if [ "$ROLLING" -eq 1 ]; then
  HI=$(date +%s)
  LO=$((HI - 86400))
else
  HI=$(date -v0H -v0M -v0S +%s)
  LO=$(date -v-4d -v0H -v0M -v0S +%s)
fi

ssh optiplex "ls ~/globular-adsb/archive/*.json 2>/dev/null | xargs -n1 basename | sed 's/\.json//' | awk -v lo=$LO -v hi=$HI '\$1 >= lo && \$1 < hi {print \$1\".json\"}'" | \
  rsync -av --files-from=- optiplex:~/globular-adsb/archive/ archive/
