# ArchSync 方案草案（代码驱动分层架构图 + 本地 LLM）

## 1. 目标（对齐你的诉求）

我们要做的不是“普通依赖图”，而是一个 **接口优先（interface-first）** 的架构系统：

1. 从代码自动抽取架构事实，生成分层框图（像 FPGA 的层层模块图）。
2. 代码变更后，图自动增量更新，不靠手工维护文档。
3. 每条连线都能解释“接口接到哪里、通过什么协议/函数/消息”。
4. 专门服务 AI 快速产码场景：在 PR 里自动输出“架构差异”和“风险点”，降低人工审查压力。

## 2. 设计原则

1. **事实优先**：边和连接先由静态分析得出，保证稳定可复现。
2. **LLM 只做语义增强**：命名、归类、摘要，不允许凭空捏造依赖。
3. **接口是第一公民**：不仅有 dependency edge，还要有 port/interface edge。
4. **可审计**：每个结论可回溯到代码证据（文件、符号、行号）。
5. **增量更新**：只重算变更影响的模块和视图。

## 3. 总体架构（五段流水线）

### A. Facts 抽取层（确定性）
输入：源码 + 构建元信息（如 `compile_commands.json`）
输出：统一事实模型（SQLite/JSON）

建议组件：
- 多语言语法：Tree-sitter
- C/C++：clang tooling / clangd 索引
- TS/JS：dependency-cruiser + tsserver
- Python：`ast` + import/call 解析（后续可补 pyright 语义）

### B. Model 建模层（规则主导）
输入：Facts
输出：分层架构模型（系统/子系统/模块/端口/连接）

实现：
- 规则配置（YAML）：路径、命名、标签到层级映射。
- 规则无法覆盖时，再调用本地 LLM 做“建议归类”。
- LLM 输出必须是 JSON Schema，并携带 evidence id。

### C. Render 渲染层
输入：架构模型
输出：多层图与文档

建议：
- 文本化模型：Structurizr DSL（利于版本管理）
- 图渲染：C4-PlantUML / Graphviz / Mermaid
- 产物：`SVG + HTML`（支持下钻链接）

### D. Diff 与规则门禁层（重点）
输入：`base commit` vs `head commit` 的架构模型
输出：架构差异报告 + 违规项

报告内容：
- 新增/删除模块
- 新增/删除接口
- 跨层依赖、环依赖、禁用连接
- API/消息契约变化

可在 CI 中作为 Gate：严重违规直接阻断合并。

### E. Watch 增量更新层
输入：文件变更事件或 `git diff`
输出：受影响子图更新

流程：
1. 识别变更文件
2. 增量重建局部 facts
3. 影响分析（symbol -> module -> view）
4. 仅重渲染受影响图

## 4. 数据模型（核心）

建议最小实体：

1. `module`：层级节点（system/subsystem/module）
2. `interface`：逻辑接口（如 REST、gRPC、AXI、事件流）
3. `port`：模块端口（in/out/bidir）
4. `edge`：连接（dependency/interface）
5. `evidence`：证据（file, symbol, line_range, parser_source）
6. `snapshot`：某次扫描结果（commit_id, timestamp）

关键约束：
- `edge` 必须关联至少一个 `evidence`。
- LLM 产生的字段只能是 `label/classification/summary`，不能直接创建无证据的 edge。

## 5. 本地 LLM 集成策略（你关心的重点）

### 5.1 适用任务

LLM 适合：
1. 模块语义命名（把 `src/core/p1` 转成可读名称）
2. 接口语义归并（把零散调用归成“帧输入接口”等）
3. 变更摘要（给 reviewer 可读说明）

LLM 不适合：
1. 判断是否存在调用/连接（应由静态分析决定）
2. 直接决定架构约束是否违反（应由规则引擎决定）

### 5.2 Provider 抽象

统一 `LLMProvider` 接口，支持：
- Ollama（本地易部署）
- vLLM（OpenAI 兼容 API）
- llama.cpp server（轻量）

### 5.3 结果可审计

每次 LLM 输出存档：
- prompt hash
- model/version
- temperature
- 输入 evidence ids
- 输出 JSON

便于复算和追责。

## 6. CLI 与工作流（建议）

```bash
archsync init
archsync build --full
archsync watch
archsync diff --base main --head HEAD
archsync ci
```

日常流程：
1. 开发者或 AI 改代码
2. `archsync diff` 自动生成架构差异报告
3. CI 执行规则门禁
4. 通过后更新基线图

## 7. 可直接借力的开源组件

1. Tree-sitter：多语言增量解析
2. clang/LibTooling：C/C++ 语义与引用分析
3. dependency-cruiser：TS/JS 依赖与规则校验
4. Structurizr DSL：架构模型文本化
5. C4-PlantUML：成熟 C4 图输出
6. Graphviz / Mermaid：补充图渲染
7. Watchman（或 chokidar）：高效文件监听
8. Ollama / vLLM / llama.cpp：本地 LLM 推理

## 8. 与现有开源的差异定位

现有工具多数只覆盖其中一部分（依赖图、C4 建模、LLM 生成图、语言专用分析）。

ArchSync 的差异点：
1. **接口优先**（port/interface wiring）
2. **分层下钻**（系统到模块）
3. **增量更新**（代码变更即更新）
4. **AI 审查导向**（架构 diff + 规则 gate）

## 9. 分阶段落地（MVP -> v1）

### Phase 1（MVP，2~3 周）

1. 支持 Python + TS/JS
2. 规则驱动分层建模
3. 输出 L0/L1 两层图（SVG）
4. 生成基础 diff 报告

### Phase 2（再 2~3 周）

1. 增加端口模型（in/out/interface type）
2. 新增门禁规则（越层、环依赖、黑名单）
3. Watch 增量更新

### Phase 3（再 2 周）

1. 接入本地 LLM（默认 Ollama）
2. 模块命名与变更摘要自动化
3. LLM 输出证据绑定与审计日志

### Phase 4（按需）

1. C/C++ 完整支持（clang tooling）
2. PR 自动评论 + 失败策略细化

## 10. 当前仓库建议下一步

1. 先实现 `archsync build` 和 `archsync diff` 两个命令。
2. 先不追求“全语言”，先把你当前项目语言打通。
3. 先把“规则引擎 + diff 报告”做硬，再叠加 LLM 语义层。

---

如果你认可这版方向，我下一步可以直接给你：

1. 项目目录骨架（`tools/archsync`）
2. `archsync.rules.yaml` 第一版
3. `archsync build/diff` 的最小可运行实现（先支持当前 Python + React）

## 11. 必须补充能力（新增）

为了达到“可直接给团队使用”的标准，除了主流程外还必须具备以下能力：

1. **规则门禁可分级**：`low/medium/high/critical`，支持 CI 失败阈值。
2. **证据可追溯**：每条边/接口都能回溯到文件与行号。
3. **LLM 审计日志**：记录模型、参数、输入输出，支持复盘。
4. **可重复构建**：`build` 在同 commit 下应输出稳定结构。
5. **可自动化验证**：必须有单元 + 集成 + e2e（浏览器交互）测试。

## 12. 安全与合规

1. LLM 只允许“重命名/摘要/归类建议”，不能直接创建事实边。
2. 默认不向公网发送代码；仅在显式配置 endpoint 时调用本地/私有模型网关。
3. 敏感仓库可关闭 LLM，仅保留确定性静态分析。

## 13. 性能目标（建议）

1. 小型仓库（<2k 文件）全量构建目标：<10 秒。
2. Watch 增量更新目标：单次变更 <2 秒。
3. Diff 报告目标：<5 秒（不含超大仓库冷启动）。

## 14. 开源工程化标准

1. 提供 MIT 许可证、贡献指南、CI workflow。
2. CLI 命令稳定：`init/build/diff/watch/ci`。
3. 文档包含：安装、最小示例、规则配置、LLM 配置、CI 集成。

## 15. 验收标准

满足以下条件即可视为可交付：

1. 任意一次代码变更可触发新的架构图和 diff 报告。
2. 报告中能明确看到模块/接口/依赖变化。
3. 规则违例可触发 CI 失败。
4. 交互式页面可点击节点查看端口与连线关系。
