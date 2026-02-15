#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-5173}"
HOST="${HOST:-127.0.0.1}"

cd "$ROOT_DIR"

# Use a fixed port and strict binding for predictable test runs.
exec pnpm dev -- --host "$HOST" --port "$PORT" --strictPort
