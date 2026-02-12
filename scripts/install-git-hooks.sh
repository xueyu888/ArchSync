#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

chmod +x scripts/archsync_strict.sh
chmod +x scripts/archsync_strict_watch.sh
chmod +x scripts/install-git-hooks.sh
chmod +x .githooks/pre-commit
chmod +x .githooks/pre-push

git config core.hooksPath .githooks

echo "Git hooks installed."
echo "pre-commit -> scripts/archsync_strict.sh --quick"
echo "pre-push   -> scripts/archsync_strict.sh --full"
