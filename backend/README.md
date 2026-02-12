# ArchSync Backend

## Language / 语言

- [English](#english)
- [中文](#中文)

## English

FastAPI service that exposes ArchSync build/diff/ci/model endpoints for the React frontend.

### Run

```bash
cd backend
uv sync --extra dev
# optional local llm for archsync build
export LOCAL_LLM_URL=http://127.0.0.1:11434/v1
export LOCAL_LLM_MODEL=qwen2.5-coder:14b
export LOCAL_LLM_KEY=
uv run uvicorn main:app --reload --host 127.0.0.1 --port 9000
```

### API

- `GET /api/health`
- `POST /api/archsync/init`
- `POST /api/archsync/build`
- `GET /api/archsync/model`
- `POST /api/archsync/diff`
- `POST /api/archsync/ci`

### Test

```bash
cd backend
uv sync --extra dev
uv run pytest
```

## 中文

提供 ArchSync build/diff/ci/model 接口的 FastAPI 服务，供 React 前端调用。

### 启动

```bash
cd backend
uv sync --extra dev
# 可选：给 archsync build 配置本地 LLM
export LOCAL_LLM_URL=http://127.0.0.1:11434/v1
export LOCAL_LLM_MODEL=qwen2.5-coder:14b
export LOCAL_LLM_KEY=
uv run uvicorn main:app --reload --host 127.0.0.1 --port 9000
```

### API

- `GET /api/health`
- `POST /api/archsync/init`
- `POST /api/archsync/build`
- `GET /api/archsync/model`
- `POST /api/archsync/diff`
- `POST /api/archsync/ci`

### 测试

```bash
cd backend
uv sync --extra dev
uv run pytest
```
