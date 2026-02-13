# ArchSync

面向 AI 生成代码的“接口优先”架构智能平台。

这个项目本身也主要由 AI 生成，目标很直接：
AI 写代码的速度已经快到人很难逐行审查。

语言： [English](README.md) | **中文**

## 项目简介

ArchSync 当前包含：

- `tools/archsync`：分析/建模/渲染/diff/watch/ci 引擎
- `backend`：暴露 ArchSync API 的 FastAPI 服务
- `frontend`：用于交互式架构评审的 React Studio
- `vscode-extension`：非侵入式 VS Code 插件（服务控制 + Studio 面板）

## 核心价值

当 AI 输出速度过快时，代码评审和文档评审都会滞后。
ArchSync 把评审重心从文本转到架构视图，评审者不再被迫逐行读代码，而是重点查看：

- 架构边界变化
- 接口/端口连线变化
- 规则违规（跨层依赖/禁止依赖/环）
- 可下钻的证据链

## 启动整套服务

### 1) 启动后端 API

```bash
cd backend
uv sync --extra dev
uv run uvicorn main:app --reload --host 127.0.0.1 --port 9000
```

### 2) 启动前端 Studio

```bash
cd frontend
npm install
npm run dev
```

访问：`http://127.0.0.1:5173`

## VS Code 插件

插件目录为 `vscode-extension`，设计目标是非侵入式：只调用已有
`uv`/`npm`/`archsync` 命令，并写入常规 ArchSync 产物（`docs/archsync`、`.archsync`）。

```bash
cd vscode-extension
npm install
npm test
npm run package
code --install-extension "$(ls -t archsync-vscode-*.vsix | head -n1)" --force
```

## 本地 LLM（可选但推荐）

ArchSync 会从环境变量读取兼容 OpenAI 的本地 LLM 配置，并自动覆盖
`.archsync/rules.yaml` 中的 LLM 参数：

```bash
export LOCAL_LLM_URL=http://127.0.0.1:11434/v1
export LOCAL_LLM_MODEL=qwen2.5-coder:14b
export LOCAL_LLM_KEY=
# 可选
export LOCAL_LLM_ENABLED=true
export LOCAL_LLM_TEMPERATURE=0.0
```

## CLI（引擎）

```bash
# 初始化
uv run --directory tools/archsync archsync init --repo .

# 生成架构产物（--full 会额外生成 mmd/dot/dsl）
uv run --directory tools/archsync archsync build --repo . --full

# 架构差异与门禁
uv run --directory tools/archsync archsync diff --repo . --base main --head HEAD
uv run --directory tools/archsync archsync ci --repo . --base main --head HEAD --fail-on high

# 增量监听
uv run --directory tools/archsync archsync watch --repo .
```

## 产物目录

生成在 `docs/archsync`：

- `architecture.model.json`
- `facts.snapshot.json`
- `mermaid/l*.mmd`（使用 `--full` 时）
- `architecture.dot`（使用 `--full` 时）
- `workspace.dsl`（使用 `--full` 时）
- `frontend-studio-e2e.png`（Playwright 端到端截图）

## 方案与实现映射

- 方案文档：`docs/ARCHSYNC_PROPOSAL_ZH.md`
- 实现映射：`docs/ARCHSYNC_IMPLEMENTATION_MAP_ZH.md`

## 质量门禁

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

统一严格门禁（与 CI 一致）：

```bash
bash scripts/archsync_strict.sh --full
```

安装本地 git hooks：

```bash
bash scripts/install-git-hooks.sh
```

Codex 编码过程中实时触发门禁：

```bash
bash scripts/archsync_strict_watch.sh
```

## 许可证

MIT（`LICENSE`）
