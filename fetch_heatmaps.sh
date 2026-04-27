#!/bin/bash
set -e

rsync -av optiplex:~/globular-adsb/dist/heatmaps/heatmap_animation.webm \
          optiplex:~/globular-adsb/dist/heatmaps/heatmap_animation.mp4 \
          dist/heatmaps/
