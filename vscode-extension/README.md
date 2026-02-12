# ArchSync VS Code Extension

## Language / 语言

- [English](#english)
- [中文](#中文)

## English

Non-intrusive VS Code extension for ArchSync.

### What it does

- Starts/stops ArchSync backend and frontend services for the current workspace.
- Runs `archsync build` from VS Code.
- Opens ArchSync Studio inside a VS Code webview panel (or external browser).
- Opens generated `docs/archsync/architecture.model.json` quickly.
- Shows a dedicated Activity Bar view (`ArchSync` icon) with:
  - `Modules` tree hierarchy
- Displays Chinese module summary + source (`LLM` or `Fallback`) in tooltip.
- Clicks tree node to open and highlight source code location.

The extension does not modify source files in your project. It only calls existing commands
(`uv`, `npm`, `archsync`) and writes standard ArchSync artifacts under `docs/archsync` and `.archsync`.

### Commands

- `ArchSync: Open Studio`
- `ArchSync: Start Services`
- `ArchSync: Stop Services`
- `ArchSync: Build Architecture Model`
- `ArchSync: Open architecture.model.json`
- `ArchSync: Refresh Sidebar`
- `ArchSync: Rebuild Model for Sidebar`
- `ArchSync: Focus Sidebar`

### Settings

- `archsync.autoStartServices` (default `true`)
- `archsync.openExternalInsteadOfWebview` (default `false`)
- `archsync.frontendMode` (`preview` or `dev`, default `preview`)
- `archsync.backendHost` / `archsync.backendPort`
- `archsync.frontendHost` / `archsync.frontendPort`
- `archsync.uvCommand` / `archsync.npmCommand`
- `archsync.backendDir` / `archsync.frontendDir` / `archsync.engineDir`

### Local LLM

The extension reuses existing ArchSync config behavior. If you set these env vars before launching VS Code,
backend/CLI will use your local LLM endpoint:

```bash
export LOCAL_LLM_URL=http://199.199.199.106:9090/v1
export LOCAL_LLM_MODEL=qwen3-30b-a3b-instruct-2507
export LOCAL_LLM_KEY=your_key
```

### Local validation

```bash
cd vscode-extension
npm install
npm test
npm run package
```

Install locally:

```bash
code --install-extension archsync-vscode-0.3.1.vsix --force
```

## 中文

面向 ArchSync 的非侵入式 VS Code 插件。

### 功能

- 为当前工作区启动/停止 ArchSync 后端与前端服务。
- 在 VS Code 内执行 `archsync build`。
- 在 VS Code Webview（或外部浏览器）打开 ArchSync Studio。
- 快速打开 `docs/archsync/architecture.model.json`。
- 在 Activity Bar 提供独立的 `ArchSync` 视图，包含：
  - `Modules` 模块树层级
- 在提示中显示中文模块摘要与来源（`LLM` 或 `Fallback`）。
- 点击模块树节点可打开并高亮源码位置。

插件不会修改你的项目源码，只会调用已有命令（`uv`、`npm`、`archsync`），
并写入标准 ArchSync 产物到 `docs/archsync` 与 `.archsync`。

### 命令

- `ArchSync: Open Studio`
- `ArchSync: Start Services`
- `ArchSync: Stop Services`
- `ArchSync: Build Architecture Model`
- `ArchSync: Open architecture.model.json`
- `ArchSync: Refresh Sidebar`
- `ArchSync: Rebuild Model for Sidebar`
- `ArchSync: Focus Sidebar`

### 配置项

- `archsync.autoStartServices`（默认 `true`）
- `archsync.openExternalInsteadOfWebview`（默认 `false`）
- `archsync.frontendMode`（`preview` 或 `dev`，默认 `preview`）
- `archsync.backendHost` / `archsync.backendPort`
- `archsync.frontendHost` / `archsync.frontendPort`
- `archsync.uvCommand` / `archsync.npmCommand`
- `archsync.backendDir` / `archsync.frontendDir` / `archsync.engineDir`

### 本地 LLM

插件复用 ArchSync 现有配置行为。启动 VS Code 前设置以下环境变量，
backend/CLI 会自动使用你的本地 LLM 端点：

```bash
export LOCAL_LLM_URL=http://199.199.199.106:9090/v1
export LOCAL_LLM_MODEL=qwen3-30b-a3b-instruct-2507
export LOCAL_LLM_KEY=your_key
```

### 本地验证

```bash
cd vscode-extension
npm install
npm test
npm run package
```

本地安装：

```bash
code --install-extension archsync-vscode-0.3.1.vsix --force
```
