# ArchSync Engine

Core implementation for ArchSync CLI and pipeline.

## Capabilities

- `analyzers`: deterministic fact extraction (`Python`, `JS/TS`)
- `model`: layered architecture model builder with interface-first ports
- `render`: architecture model + export artifacts (JSON/Mermaid/DOT/DSL)
- `diff`: architecture diff + rule violation detection + cycle detection
- `watch`: auto rebuild loop for local development
- `llm`: local OpenAI-compatible enrichment with audit logging

## Commands

```bash
archsync init
archsync build --full
archsync diff --base main --head HEAD
archsync ci --fail-on high
archsync watch
```

## Local LLM Environment Overrides

When set, these environment variables override `rules.yaml` `llm.*` fields:

- `LOCAL_LLM_URL`
- `LOCAL_LLM_MODEL`
- `LOCAL_LLM_KEY`
- `LOCAL_LLM_ENABLED` (`true/false`)
- `LOCAL_LLM_PROVIDER` (default `openai_compatible`)
- `LOCAL_LLM_TEMPERATURE`

`--full` output includes:

- `mermaid/*.mmd`
- `architecture.dot`
- `workspace.dsl`

## Development

```bash
uv sync --extra dev
uv run ruff check src tests
uv run pytest
```

## Test Matrix

- Unit: analyzers/model/rules
- Integration: CLI init/build/diff
- E2E: React frontend (separate `frontend` app)
