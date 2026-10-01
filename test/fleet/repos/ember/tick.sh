#!/bin/sh
# ember heartbeat: append the time to loop.log and print it.
cd "$(dirname "$0")" || exit 1
date '+%Y-%m-%dT%H:%M:%S%z' >> loop.log
echo "tick $(wc -l < loop.log | tr -d ' '): $(tail -n 1 loop.log)"
