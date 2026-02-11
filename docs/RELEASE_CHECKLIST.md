# Release Checklist

1. `uv run --directory tools/archsync ruff check src tests`
2. `uv run --directory tools/archsync pytest`
3. `uv run --directory tools/archsync archsync build --repo .`
4. `uv run --directory tools/archsync archsync diff --repo . --base main --head HEAD`
5. `uv run --directory tools/archsync archsync ci --repo . --base main --head HEAD --fail-on high`
6. Confirm `README.md`, `LICENSE`, `CONTRIBUTING.md` are updated.
7. Tag release and publish notes.
