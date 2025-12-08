#!/usr/bin/env sh
set -eu

# Helper to run the CLI inside the cli-pong container
# Usage: ./scripts/pong-cli.sh <command> [args]

DC="docker compose"

if ! $DC ps -q cli-pong >/dev/null 2>&1 || [ -z "$($DC ps -q cli-pong)" ]; then
  echo "Starting cli-pong service..." >&2
  $DC up -d --build cli-pong
fi

exec $DC exec -it cli-pong pong-cli "$@"
