# Contributing

## Development Setup

```bash
cd tools/archsync
uv sync --extra dev
```

## Local Quality Gates

```bash
uv run ruff check src tests
uv run pytest
```

## Pull Request Expectations

- Add/adjust tests for behavior changes.
- Keep facts extraction deterministic; LLM must stay enrichment-only.
- Include sample output changes when diagram/render behavior is modified.
- Avoid breaking `archsync diff` and `archsync ci` outputs.

## Commit Style

Use concise conventional prefixes, e.g.:

- `feat:` new capability
- `fix:` bug fix
- `docs:` documentation
- `test:` tests
- `chore:` tooling/refactor
