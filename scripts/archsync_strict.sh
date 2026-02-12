#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="full"

for arg in "$@"; do
  case "$arg" in
    --quick)
      MODE="quick"
      ;;
    --full|--ci)
      MODE="full"
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: scripts/archsync_strict.sh [--quick|--full]" >&2
      exit 2
      ;;
  esac
done

run_step() {
  local label="$1"
  shift
  echo ""
  echo "[AGENTS_STRICT] $label"
  "$@"
}

cd "$ROOT_DIR"

run_step "Structure guard" \
  uv run --directory tools/archsync python -m archsync.quality.structure_guard --repo "$ROOT_DIR" --config "$ROOT_DIR/.archsync/strict_limits.yaml"

run_step "Engine lint (ruff)" \
  uv run --directory tools/archsync ruff check src tests

run_step "Backend lint (ruff via engine env)" \
  uv run --directory tools/archsync ruff check --select E,F --ignore E501 "$ROOT_DIR/backend/main.py" "$ROOT_DIR/backend/tests"

run_step "Engine tests" \
  uv run --directory tools/archsync pytest -q

if [[ "$MODE" == "quick" ]]; then
  run_step "Frontend lint" npm --prefix frontend run lint
  echo ""
  echo "[AGENTS_STRICT] quick mode complete."
  exit 0
fi

run_step "Backend tests" \
  uv run --directory backend pytest -q

run_step "Frontend lint" \
  npm --prefix frontend run lint

run_step "Frontend build" \
  npm --prefix frontend run build

run_step "VS Code extension tests" \
  npm --prefix vscode-extension test

run_step "Build architecture output" \
  uv run --directory tools/archsync archsync build --repo "$ROOT_DIR"

echo ""
echo "[AGENTS_STRICT] full mode complete."
