# ArchSync VS Code Extension

Non-intrusive VS Code extension for ArchSync.

## What it does

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

## Commands

- `ArchSync: Open Studio`
- `ArchSync: Start Services`
- `ArchSync: Stop Services`
- `ArchSync: Build Architecture Model`
- `ArchSync: Open architecture.model.json`
- `ArchSync: Refresh Sidebar`
- `ArchSync: Rebuild Model for Sidebar`
- `ArchSync: Focus Sidebar`

## Settings

- `archsync.autoStartServices` (default `true`)
- `archsync.openExternalInsteadOfWebview` (default `false`)
- `archsync.frontendMode` (`preview` or `dev`, default `preview`)
- `archsync.backendHost` / `archsync.backendPort`
- `archsync.frontendHost` / `archsync.frontendPort`
- `archsync.uvCommand` / `archsync.npmCommand`
- `archsync.backendDir` / `archsync.frontendDir` / `archsync.engineDir`

## Local LLM

The extension reuses existing ArchSync config behavior. If you set these env vars before launching VS Code,
backend/CLI will use your local LLM endpoint:

```bash
export LOCAL_LLM_URL=http://199.199.199.106:9090/v1
export LOCAL_LLM_MODEL=qwen3-30b-a3b-instruct-2507
export LOCAL_LLM_KEY=your_key
```

## Local validation

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
