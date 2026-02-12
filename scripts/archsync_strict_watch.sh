#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

uv run --directory tools/archsync python -m archsync.quality.strict_watch --repo "$ROOT_DIR" "$@"

