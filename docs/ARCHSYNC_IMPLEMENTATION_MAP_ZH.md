# ArchSync 方案-实现对照（逐项落地）

本文将 `docs/ARCHSYNC_PROPOSAL_ZH.md` 的功能点逐项映射到代码、接口和测试，确保方案与实现一致。

## 1. 目标落地对照

| 目标 | 实现位置 | 接口/命令 | 验证 |
|---|---|---|---|
| 代码自动抽取分层架构 | `tools/archsync/src/archsync/analyzers/*`, `model/builder.py` | `archsync build` | `tools/archsync/tests/test_extract_facts.py` |
| 代码变更图自动更新 | `tools/archsync/src/archsync/watch/service.py` | `archsync watch` | `tools/archsync/tests/test_watch_service.py` |
| 连线可解释（协议/接口） | `schemas.py`, `analyzers/*`, `model/builder.py` | `architecture.model.json` | `tools/archsync/tests/test_model_builder.py` |
| PR 架构差异与风险 | `diff/engine.py`, `diff/rules_engine.py`, `diff/report_writer.py` | `archsync diff`, `archsync ci` | `tools/archsync/tests/test_diff_rules.py`, `test_cli_integration.py` |

## 2. 设计原则落地

1. 事实优先：边由解析器抽取（`analyzers/python_analyzer.py`, `analyzers/js_analyzer.py`）。
2. LLM 仅语义增强：`llm/provider.py` 只返回命名/摘要，不写事实边。
3. 接口一等公民：`InterfaceFact`, `PortNode`，并在模型中形成 `interface` edge。
4. 可审计：`Evidence`、`evidence_id` 全链路传递。
5. 增量更新：watch 模式含影响视图分析 `_impacted_views`。

## 3. 五段流水线对照

### A. Facts 抽取层

- 入口：`extract_facts` (`tools/archsync/src/archsync/analyzers/engine.py`)
- 输出：`FactsSnapshot`（JSON + SQLite）
- SQLite：`tools/archsync/src/archsync/storage/sqlite_store.py`

### B. Model 建模层

- 规则配置：`.archsync/rules.yaml`
- 规则映射 + 模块分层：`tools/archsync/src/archsync/model/builder.py`
- LLM 建议：`tools/archsync/src/archsync/llm/provider.py`

### C. Render 渲染层

- 模型与导出：`tools/archsync/src/archsync/render/renderer.py`
- 全量产物（`--full`）：Mermaid、DOT、Structurizr DSL

### D. Diff 与门禁层

- Diff 核心：`tools/archsync/src/archsync/diff/engine.py`
- 规则：`tools/archsync/src/archsync/diff/rules_engine.py`
- 报告：`tools/archsync/src/archsync/diff/report_writer.py`

### E. Watch 增量层

- 文件指纹监测：`watch/service.py`
- 影响视图分析：`_impacted_views`
- 增量重渲策略：`render_outputs(..., only_views=...)`

## 4. 数据模型对照

定义文件：`tools/archsync/src/archsync/schemas.py`

- `module` -> `ModuleFact` / `ModuleNode`
- `interface` -> `InterfaceFact`
- `port` -> `PortNode`
- `edge` -> `EdgeFact` / `ArchitectureEdge`
- `evidence` -> `Evidence`
- `snapshot` -> `FactsSnapshot`

约束落实：

- 边需证据：`EdgeFact.evidence_id`
- LLM 不造边：provider 仅输出命名/摘要字段

## 5. 本地 LLM 集成对照

- Provider 抽象：`LLMProvider` (`llm/provider.py`)
- OpenAI 兼容接入：`OpenAICompatibleProvider`
- 审计日志：`.archsync/llm_audit/*.json`
- 审计字段：`prompt_hash`、model、temperature、input_evidence_ids、request/response

## 6. CLI 与工作流对照

命令定义：`tools/archsync/src/archsync/cli.py`

- `archsync init`
- `archsync build [--full]`
- `archsync diff --base --head`
- `archsync ci --fail-on`
- `archsync watch`

## 7. 开源组件映射

见：`docs/OPEN_SOURCE_REFERENCES.md`

- 解析：Tree-sitter（规划位）
- 图生态：Mermaid/DOT/Structurizr DSL 输出
- 本地模型：OpenAI 兼容 endpoint（Ollama/vLLM/llama.cpp）

## 8. 差异化落地

1. 接口优先：端口和 `interface edge` 可视化。
2. 分层下钻：前端按父子节点无限下钻到叶子层。
3. 增量更新：watch 影响视图更新。
4. AI 审查导向：diff + rule gate + CI。

## 9. 分阶段能力状态

| Phase | 功能 | 状态 |
|---|---|---|
| 1 | Python + TS/JS, 规则分层, L0/L1, diff | 已实现 |
| 2 | 端口模型, 规则门禁, watch 增量 | 已实现 |
| 3 | 本地 LLM 命名摘要, 审计日志 | 已实现 |
| 4 | C/C++ 支持 | 已实现轻量版本（include/函数/协议关键字）；clang 深语义仍可继续扩展 |

## 10. API 与真实前端应用（新增）

### Backend API（FastAPI）

文件：`backend/main.py`

- `GET /api/health`
- `POST /api/archsync/init`
- `POST /api/archsync/build`
- `GET /api/archsync/model`
- `POST /api/archsync/diff`
- `POST /api/archsync/ci`

### Frontend Studio（React）

文件：`frontend/src/App.jsx`, `frontend/src/api.js`

- 实时调用 build/diff/ci/model API
- 交互式图板 + 模块详情 + 连线过滤 + 搜索
- Diff/CI 结果面板

## 11. 必须补充能力对照

1. 分级门禁：`ci --fail-on`，`severity` 贯穿。
2. 证据追溯：`evidence_id` + `facts.snapshot.json`。
3. LLM 审计：`llm_audit` + `prompt_hash`。
4. 可重复构建：同 commit 输出稳定结构（id/hash +固定流程）。
5. 自动化验证：单元/集成/e2e。

## 12. 安全与合规

- 默认 LLM 关闭（`.archsync/rules.yaml`）。
- 开启时需显式 endpoint。
- LLM 仅语义增强，不改事实边。

## 13. 性能策略

- Watch 采用文件指纹 + 影响视图重渲。
- Diff 采用快照模型对比。
- SQLite 缓存事实，减少重复 I/O。

## 14. 开源工程化

- `LICENSE`（MIT）
- `CONTRIBUTING.md`
- `.github/workflows/archsync-ci.yml`
- 统一 README 与发布清单：`docs/RELEASE_CHECKLIST.md`

## 15. 验收结果（本次实现）

- [x] 代码改动可触发新图和 diff
- [x] 报告明确模块/接口/依赖变化（含 `api_surface_changes`）
- [x] 规则违例可触发 CI 失败
- [x] 交互式前端可点击模块查看端口与连线
