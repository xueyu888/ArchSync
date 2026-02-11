# ArchSync Engine

Core implementation for ArchSync CLI and pipeline.

## Capabilities

- `analyzers`: deterministic fact extraction (`Python`, `JS/TS`)
- `model`: layered architecture model builder with interface-first ports
- `render`: interactive dashboard (`L0/L1/L2`) + SVG + JSON
- `diff`: architecture diff + rule violation detection + cycle detection
- `watch`: auto rebuild loop for local development
- `llm`: local OpenAI-compatible enrichment with audit logging

## Commands

```bash
archsync init
archsync build
archsync diff --base main --head HEAD
archsync ci --fail-on high
archsync watch
```

## Development

```bash
uv sync --extra dev
uv run ruff check src tests
uv run pytest
```

## Test Matrix

- Unit: analyzers/model/rules
- Integration: CLI init/build/diff
- E2E: Playwright click + screenshot on generated dashboard
