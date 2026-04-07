#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Resolve the main worktree root (where node_modules lives)
REPO_ROOT="$(cd "$SCRIPT_DIR" && git rev-parse --git-common-dir)"
REPO_ROOT="$(cd "${REPO_ROOT%/.git}" && pwd)"

# Source environment variables from .env file
if [[ -f "$SCRIPT_DIR/.env" ]]; then
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
fi

# Build packages that need building
npm run --prefix "$REPO_ROOT" build

# Ensure node_modules is accessible from this worktree
if [[ ! -d "$SCRIPT_DIR/node_modules" && -d "$REPO_ROOT/node_modules" ]]; then
    ln -s "$REPO_ROOT/node_modules" "$SCRIPT_DIR/node_modules"
fi

# Run local pi from the repo
TSX_BIN="$REPO_ROOT/node_modules/.bin/tsx"
"$TSX_BIN" "$SCRIPT_DIR/packages/coding-agent/src/cli.ts" "$@"
