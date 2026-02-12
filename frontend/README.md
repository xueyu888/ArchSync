# ArchSync Frontend

## Language / 语言

- [English](#english)
- [中文](#中文)

## English

React application for interactive architecture analysis.

### Features

- Semantic-zoom architecture exploration (focus + expanded hierarchy + context)
- Module search/filter and edge-type toggles
- Deterministic edge aggregation for current semantic view
- Lane-based architecture canvas with orthogonal wiring
- Drag-and-drop module arrangement and auto layout reset
- Visible links strip with endpoint/protocol labels
- Module properties and incoming/outgoing link inspection
- Trigger ArchSync build/diff/ci directly from UI

### Run

Start backend first:

```bash
cd ../backend
uv sync --extra dev
uv run uvicorn main:app --reload --host 127.0.0.1 --port 9000
```

Then start frontend:

```bash
cd ../frontend
npm install
npm run dev
```

Open: `http://127.0.0.1:5173`

## 中文

用于交互式架构分析的 React 前端应用。

### 功能

- 语义放大式架构浏览（焦点 + 可展开层级 + 外层上下文）
- 模块搜索/筛选和边类型开关
- 当前语义视图下的稳定边聚合
- 分层泳道画布与正交连线
- 模块拖拽排布与一键自动布局重置
- 可见链路条，显示端点/协议标签
- 模块属性、入边/出边详情查看
- 在 UI 内直接触发 ArchSync build/diff/ci

### 运行

先启动后端：

```bash
cd ../backend
uv sync --extra dev
uv run uvicorn main:app --reload --host 127.0.0.1 --port 9000
```

再启动前端：

```bash
cd ../frontend
npm install
npm run dev
```

访问：`http://127.0.0.1:5173`
