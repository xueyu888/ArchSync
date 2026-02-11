# Release Checklist

1. `uv run --directory tools/archsync ruff check src tests`
2. `uv run --directory tools/archsync pytest`
3. `uv run --directory backend pytest`
4. `npm --prefix frontend run lint`
5. `npm --prefix frontend run build`
6. `uv run --directory tools/archsync archsync build --repo . --full`
7. `uv run --directory tools/archsync archsync diff --repo . --base main --head HEAD`
8. `uv run --directory tools/archsync archsync ci --repo . --base main --head HEAD --fail-on high`
9. Optional e2e screenshot: open frontend and capture with Playwright.
10. Confirm `README.md`, `LICENSE`, `CONTRIBUTING.md` are updated.
11. Tag release and publish notes.
