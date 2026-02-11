# ArchSync

Interface-first architecture diagrams generated from code, with layered drill-down, incremental updates,
and architecture diff gates for AI-generated code review.

## Why ArchSync

LLM agents (Codex/Claude/etc.) write code faster than humans can review line-by-line.
ArchSync shifts review from raw code volume to architecture impact:

- What module boundaries changed?
- What interfaces/ports changed?
- Are there new cross-layer or forbidden dependencies?
- Did a cycle appear?

## What You Get

- Deterministic fact extraction (`Python`, `JS/TS`) from source code
- Layered architecture model (`System -> Layer -> Module -> File`)
- Interface/port-aware wiring (in/out ports, protocol labels)
- Interactive dashboard (`L0/L1/L2`) with click-to-inspect ports
- Architecture diff reports (`added/removed modules, ports, edges`)
- Rule gates (`layer order`, `forbidden dependencies`, `cycle detection`)
- Local LLM enrichment hook (Ollama/vLLM/llama.cpp via OpenAI-compatible API)
- CI-friendly CLI (`init/build/diff/watch/ci`)

## Repository Layout

- `tools/archsync`: Core engine + CLI + tests
- `docs/ARCHSYNC_PROPOSAL_ZH.md`: Full Chinese design proposal
- `docs/OPEN_SOURCE_REFERENCES.md`: Upstream OSS components used/referenced
- `frontend`, `backend`: bootstrap app scaffold used in initial setup

## Quick Start

```bash
# install tool dependencies
cd tools/archsync
uv sync --extra dev
```

```bash
# initialize config at repo root
uv run --directory tools/archsync archsync init --repo .
```

```bash
# build architecture model + dashboard
uv run --directory tools/archsync archsync build --repo .
```

Outputs:

- `docs/archsync/index.html` (interactive dashboard)
- `docs/archsync/architecture.model.json`
- `docs/archsync/facts.snapshot.json`

## Diff & CI Gate

```bash
# compare two refs
uv run --directory tools/archsync archsync diff --repo . --base main --head HEAD
```

```bash
# fail CI on high+ severity violations
uv run --directory tools/archsync archsync ci --repo . --base main --head HEAD --fail-on high
```

## Watch Mode

```bash
uv run --directory tools/archsync archsync watch --repo . --interval 1.5
```

When code changes, ArchSync rebuilds diagrams incrementally from source state.

## Local LLM Integration

Edit `.archsync/rules.yaml`:

```yaml
llm:
  enabled: true
  provider: openai_compatible
  model: qwen2.5-coder:14b
  endpoint: "http://127.0.0.1:11434/v1"
  api_key: ""
  temperature: 0.0
```

ArchSync stores auditable logs in `.archsync/llm_audit/` with request/response payloads.

## Tests

```bash
cd tools/archsync
uv run ruff check src tests
uv run pytest
```

Includes Playwright e2e test that loads dashboard, clicks a module node, and writes a screenshot.

## Open-Source Self-Test (Done)

ArchSync was self-validated on an external OSS repo (`pallets/flask`) with:

1. `archsync build`
2. Playwright click + screenshot (`playwright-selftest.png`)

Reference screenshot committed at `docs/selftest-flask-playwright.png`.

## GitHub Actions

CI workflow file: `.github/workflows/archsync-ci.yml`

## License

MIT (`LICENSE`)
