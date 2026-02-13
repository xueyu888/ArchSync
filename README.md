# ArchSync

Code in, architecture graph out.

This project itself is primarily generated with AI, and it exists for one reason:
AI can produce code faster than humans can review line by line, and docs quickly lag behind.

Language: **English** | [中文](README.zh-CN.md)

## Core Value (Read This First)

- Code can be modeled as: input -> process -> output.
- Systems can be modeled as: modules and their compositions.
- ArchSync turns source code structure into architecture views, so review shifts from reading text to inspecting relationships.
- When AI output is too fast, reviewers focus on boundaries, dependency direction, interface wiring, and rule violations.

## Overview

ArchSync includes:

- `tools/archsync`: analysis/model/render/diff/watch/ci engine
- `backend`: FastAPI service exposing ArchSync APIs
- `frontend`: React Studio application for interactive architecture review
- `vscode-extension`: non-intrusive VS Code plugin (service control + Studio panel)

## Run Full Stack

### 1) Backend API

```bash
cd backend
uv sync --extra dev
uv run uvicorn main:app --reload --host 127.0.0.1 --port 9000
```

### 2) Frontend Studio

```bash
cd frontend
npm install
npm run dev
```

Open: `http://127.0.0.1:5173`

## VS Code Extension

The extension is in `vscode-extension` and is non-intrusive: it only invokes existing
`uv`/`npm`/`archsync` commands and writes normal ArchSync outputs (`docs/archsync`, `.archsync`).

```bash
cd vscode-extension
npm install
npm test
npm run package
code --install-extension "$(ls -t archsync-vscode-*.vsix | head -n1)" --force
```

## Local LLM (Optional but Recommended)

ArchSync reads local OpenAI-compatible LLM settings from environment variables and
overrides `.archsync/rules.yaml` automatically:

```bash
export LOCAL_LLM_URL=http://127.0.0.1:11434/v1
export LOCAL_LLM_MODEL=qwen2.5-coder:14b
export LOCAL_LLM_KEY=
# optional
export LOCAL_LLM_ENABLED=true
export LOCAL_LLM_TEMPERATURE=0.0
```

## CLI (Engine)

```bash
# initialize
uv run --directory tools/archsync archsync init --repo .

# build architecture artifacts (full includes mmd/dot/dsl)
uv run --directory tools/archsync archsync build --repo . --full

# architecture diff and gate
uv run --directory tools/archsync archsync diff --repo . --base main --head HEAD
uv run --directory tools/archsync archsync ci --repo . --base main --head HEAD --fail-on high

# watch for incremental updates
uv run --directory tools/archsync archsync watch --repo .
```

## Artifacts

Generated under `docs/archsync`:

- `architecture.model.json`
- `facts.snapshot.json`
- `mermaid/l*.mmd` (when `--full`)
- `architecture.dot` (when `--full`)
- `workspace.dsl` (when `--full`)
- `frontend-studio-e2e.png` (Playwright end-to-end screenshot)

## Proposal & Implementation Mapping

- Proposal: `docs/ARCHSYNC_PROPOSAL_ZH.md`
- Implementation map: `docs/ARCHSYNC_IMPLEMENTATION_MAP_ZH.md`

## Quality Gates

```bash
# engine
cd tools/archsync
uv sync --extra dev
uv run ruff check src tests
uv run pytest

# backend
cd ../../backend
uv sync --extra dev
uv run pytest

# frontend
cd ../frontend
npm run lint
npm run build
```

Unified strict gate (matches CI):

```bash
bash scripts/archsync_strict.sh --full
```

Install local git hooks:

```bash
bash scripts/install-git-hooks.sh
```

Run realtime strict watcher while Codex is editing:

```bash
bash scripts/archsync_strict_watch.sh
```

## License

MIT (`LICENSE`)
