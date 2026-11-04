#!/bin/sh
# Keep the Mac awake (incl. clamshell mode: -d keeps the external display on) while crawling.
cd "$(dirname "$0")/../.." || exit 1
exec caffeinate -dims node tools/crawl/main.js "$@"
