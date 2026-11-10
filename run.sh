#!/bin/sh
# Starts the RolePlay platform.
#   ./run.sh             build the web UI, start the server, open the browser
#   ./run.sh dev         server and web UI that reload on change (for working on the code)
#   ./run.sh --no-open   do not open the browser
# The work is done by scripts/launch.mjs; this only finds Node.js.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install Node.js 20.12 or newer from https://nodejs.org and run this again."
  exit 1
fi

exec node scripts/launch.mjs "$@"
