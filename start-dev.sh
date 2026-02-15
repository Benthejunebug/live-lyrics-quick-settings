#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v pnpm >/dev/null 2>&1; then
    echo "Error: pnpm is not installed. Install pnpm first: https://pnpm.io/installation"
    exit 1
fi

if [ ! -d node_modules ]; then
    echo "Installing dependencies..."
    pnpm install
fi

echo "Starting dev server..."
pnpm run dev
