#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source environment variables from .env file
if [[ -f "$SCRIPT_DIR/.env" ]]; then
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
fi

# Build packages that need building
npm run build

# Run local pi from the repo
TSX_BIN="$SCRIPT_DIR/node_modules/.bin/tsx"
"$TSX_BIN" "$SCRIPT_DIR/packages/coding-agent/src/cli.ts" "$@"
