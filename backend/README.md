# ArchSync Backend

FastAPI service that exposes ArchSync build/diff/ci/model endpoints for the React frontend.

## Run

```bash
cd backend
uv sync --extra dev
# optional local llm for archsync build
export LOCAL_LLM_URL=http://127.0.0.1:11434/v1
export LOCAL_LLM_MODEL=qwen2.5-coder:14b
export LOCAL_LLM_KEY=
uv run uvicorn main:app --reload --host 127.0.0.1 --port 9000
```

## API

- `GET /api/health`
- `POST /api/archsync/init`
- `POST /api/archsync/build`
- `GET /api/archsync/model`
- `POST /api/archsync/diff`
- `POST /api/archsync/ci`

## Test

```bash
cd backend
uv sync --extra dev
uv run pytest
```
