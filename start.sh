#!/bin/bash
set -a
source .env
set +a

source .venv/bin/activate
nohup globular-scheduler > archive.log 2>&1 &
echo "Started PID $!"
