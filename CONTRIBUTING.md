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

## AGENTS_STRICT Gate

Run the unified gate before pushing:

```bash
bash scripts/archsync_strict.sh --full
```

Install local git hooks (recommended):

```bash
bash scripts/install-git-hooks.sh
```

This installs `.githooks/pre-commit`, which runs:

```bash
bash scripts/archsync_strict.sh --quick
```

And `.githooks/pre-push`, which runs:

```bash
bash scripts/archsync_strict.sh --full
```

For realtime checks during Codex editing, run:

```bash
bash scripts/archsync_strict_watch.sh
```

## Pull Request Expectations

- Add/adjust tests for behavior changes.
- Keep facts extraction deterministic; LLM must stay enrichment-only.
- Include sample output changes when diagram/render behavior is modified.
- Avoid breaking `archsync diff` and `archsync ci` outputs.
- Include an AGENTS principle compliance report using `docs/templates/AGENTS_COMPLIANCE_REPORT.md`.

## Commit Style

Use concise conventional prefixes, e.g.:

- `feat:` new capability
- `fix:` bug fix
- `docs:` documentation
- `test:` tests
- `chore:` tooling/refactor
