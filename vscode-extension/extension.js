const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { ArchSyncServiceManager } = require('./runtime');
const {
  buildChildrenLookup,
  findSystemModule,
} = require('./model-utils');

let outputChannel;
let manager;
let managerRoot = '';
let revealDecoration;

const REVEAL_FLASH_MS = 1800;
const MODULES_VIEW_ID = 'archsyncModulesView';
const ARCHSYNC_VIEW_CONTAINER_CMD = 'workbench.view.extension.archsync';

function getWorkspaceRoot() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return '';
  }
  return folders[0].uri.fsPath;
}

function getConfigValue(key, fallback) {
  return vscode.workspace.getConfiguration('archsync').get(key, fallback);
}

function createManager(root) {
  const nextOptions = {
    root,
    uvCommand: getConfigValue('uvCommand', 'uv'),
    npmCommand: getConfigValue('npmCommand', 'npm'),
    backendDir: getConfigValue('backendDir', 'backend'),
    frontendDir: getConfigValue('frontendDir', 'frontend'),
    engineDir: getConfigValue('engineDir', 'tools/archsync'),
    backendHost: getConfigValue('backendHost', '127.0.0.1'),
    backendPort: getConfigValue('backendPort', 9000),
    frontendHost: getConfigValue('frontendHost', '127.0.0.1'),
    frontendPort: getConfigValue('frontendPort', 5173),
    frontendMode: getConfigValue('frontendMode', 'preview'),
    logger: outputChannel,
  };

  if (manager && managerRoot === root) {
    manager.uvCommand = nextOptions.uvCommand;
    manager.npmCommand = nextOptions.npmCommand;
    manager.backendDir = nextOptions.backendDir;
    manager.frontendDir = nextOptions.frontendDir;
    manager.engineDir = nextOptions.engineDir;
    manager.backendHost = nextOptions.backendHost;
    manager.backendPort = nextOptions.backendPort;
    manager.frontendHost = nextOptions.frontendHost;
    manager.frontendPort = nextOptions.frontendPort;
    manager.frontendMode = nextOptions.frontendMode;
    return manager;
  }

  if (manager && managerRoot !== root) {
    manager.stopAll().catch(() => {});
  }

  manager = new ArchSyncServiceManager(nextOptions);
  managerRoot = root;
  return manager;
}

function panelHtml(frontendUrl) {
  const nonce = Math.random().toString(36).slice(2);
  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-src http: https:;">
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #f6f8fb; }
    .toolbar { height: 42px; display: flex; align-items: center; gap: 8px; padding: 0 10px; border-bottom: 1px solid #d0dbe8; font-family: sans-serif; background: #fff; }
    .toolbar button { border: 1px solid #b8c7d9; border-radius: 8px; background: #fff; cursor: pointer; padding: 4px 10px; }
    .toolbar .url { color: #4b6178; font-size: 12px; }
    iframe { width: 100%; height: calc(100% - 42px); border: 0; background: #fff; }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="reload">Reload</button>
    <button id="open">Open In Browser</button>
    <span class="url">${frontendUrl}</span>
  </div>
  <iframe id="studio" src="${frontendUrl}"></iframe>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const frame = document.getElementById('studio');
    document.getElementById('reload').addEventListener('click', () => {
      frame.src = frame.src;
    });
    document.getElementById('open').addEventListener('click', () => {
      vscode.postMessage({ type: 'openExternal', url: frame.src });
    });
  </script>
</body>
</html>`;
}

function normalizeModelPath(input) {
  return String(input || '').replaceAll('\\\\', '/');
}

function isFilePath(root, modulePath) {
  if (!root || !modulePath || modulePath === '/') {
    return false;
  }
  const target = path.join(root, modulePath);
  try {
    return fs.existsSync(target) && fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

function toRelativeModelPath(root, absolutePath) {
  if (!root || !absolutePath) {
    return null;
  }
  const relative = normalizeModelPath(path.relative(root, absolutePath));
  if (!relative || relative.startsWith('..')) {
    return null;
  }
  return relative;
}

function loadModelBundle(root, logger) {
  if (!root) {
    return null;
  }

  const modelPath = path.join(root, 'docs', 'archsync', 'architecture.model.json');
  if (!fs.existsSync(modelPath)) {
    logger?.appendLine?.(`[archsync.model] model not found: ${modelPath}`);
    return null;
  }

  try {
    const modelRaw = fs.readFileSync(modelPath, 'utf-8');
    const model = JSON.parse(modelRaw);
    const modules = Array.isArray(model.modules) ? model.modules : [];
    const moduleById = new Map(modules.map((item) => [item.id, item]));
    const childrenByParent = buildChildrenLookup(modules);

    const summaryById = model.metadata?.llm_summaries || {};
    const summarySourceById = model.metadata?.llm_summary_source || {};

    const evidenceLineByPath = new Map();
    const snapshotPath = path.join(root, 'docs', 'archsync', 'facts.snapshot.json');
    if (fs.existsSync(snapshotPath)) {
      try {
        const snapshotRaw = fs.readFileSync(snapshotPath, 'utf-8');
        const snapshot = JSON.parse(snapshotRaw);
        const evidences = Array.isArray(snapshot.evidences) ? snapshot.evidences : [];
        for (const item of evidences) {
          const filePath = normalizeModelPath(item?.file_path || '');
          const line = Number(item?.line_start || 1);
          if (!filePath) {
            continue;
          }
          const current = evidenceLineByPath.get(filePath);
          if (!current || line < current) {
            evidenceLineByPath.set(filePath, line);
          }
        }
      } catch (error) {
        logger?.appendLine?.(`[archsync.model] failed to parse snapshot: ${String(error)}`);
      }
    }

    const pathToModuleId = new Map();
    for (const module of modules) {
      const modulePath = normalizeModelPath(module.path || '');
      if (!modulePath || modulePath === '/') {
        continue;
      }
      if (!pathToModuleId.has(modulePath)) {
        pathToModuleId.set(modulePath, module.id);
      }
    }

    const systemModule = findSystemModule(modules);

    return {
      root,
      model,
      modules,
      moduleById,
      childrenByParent,
      summaryById,
      summarySourceById,
      evidenceLineByPath,
      pathToModuleId,
      systemModule,
    };
  } catch (error) {
    logger?.appendLine?.(`[archsync.model] failed to parse model: ${String(error)}`);
    return null;
  }
}

function resolveSourceHint(bundle, moduleId) {
  if (!bundle || !moduleId) {
    return null;
  }

  const module = bundle.moduleById.get(moduleId);
  if (!module) {
    return null;
  }

  const directPath = normalizeModelPath(module.path || '');
  if (isFilePath(bundle.root, directPath)) {
    return {
      path: directPath,
      absolutePath: path.join(bundle.root, directPath),
      line: bundle.evidenceLineByPath.get(directPath) || 1,
      moduleId,
    };
  }

  const queue = [moduleId];
  const visited = new Set();
  while (queue.length) {
    const currentId = queue.shift();
    if (visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);

    const children = bundle.childrenByParent.get(currentId) || [];
    for (const child of children) {
      const childPath = normalizeModelPath(child.path || '');
      if (isFilePath(bundle.root, childPath)) {
        return {
          path: childPath,
          absolutePath: path.join(bundle.root, childPath),
          line: bundle.evidenceLineByPath.get(childPath) || 1,
          moduleId: child.id,
        };
      }
      queue.push(child.id);
    }
  }

  return null;
}

class ArchSyncSidebarProvider {
  constructor(logger) {
    this.logger = logger;
    this.root = '';
    this.bundle = null;

    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  setRoot(root) {
    if (this.root === root) {
      return;
    }
    this.root = root;
    this.bundle = null;
    this._onDidChangeTreeData.fire();
  }

  refresh() {
    this.bundle = null;
    this._onDidChangeTreeData.fire();
  }

  async getTreeItem(element) {
    return element;
  }

  async getChildren(element) {
    if (!this.root) {
      return [this._createInfoItem('Open a workspace folder to use ArchSync.')];
    }

    await this._ensureBundle();

    if (!this.bundle || !this.bundle.systemModule) {
      const item = this._createInfoItem('No architecture model yet. Run “ArchSync: Build Architecture Model”.');
      item.command = {
        command: 'archsync.buildModel',
        title: 'Build Architecture Model',
      };
      return [item];
    }

    const parentId = element?.moduleId || this.bundle.systemModule.id;
    const children = this.bundle.childrenByParent.get(parentId) || [];
    return children.map((module) => this._createModuleItem(module));
  }

  _createInfoItem(label) {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'info';
    return item;
  }

  _createModuleItem(module) {
    const children = this.bundle.childrenByParent.get(module.id) || [];
    const collapsibleState = children.length
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;

    const item = new vscode.TreeItem(module.name, collapsibleState);
    item.moduleId = module.id;
    item.contextValue = 'module';

    const source = this.bundle.summarySourceById[module.id] || 'fallback';
    const sourceTag = source === 'llm' ? 'LLM' : 'Fallback';
    item.description = `${module.layer} · L${module.level} · ${sourceTag}`;

    item.iconPath = children.length
      ? new vscode.ThemeIcon('package')
      : new vscode.ThemeIcon('symbol-file');

    const summary = this.bundle.summaryById[module.id] || '';
    const tooltip = new vscode.MarkdownString();
    tooltip.isTrusted = false;
    tooltip.appendMarkdown(`**${module.name}**  \n`);
    tooltip.appendMarkdown(`层级: \`${module.layer}\` · L${module.level}  \n`);
    tooltip.appendMarkdown(`路径: \`${module.path || '/'}\`  \n`);
    tooltip.appendMarkdown(`说明来源: **${source === 'llm' ? 'Local LLM' : 'Fallback'}**`);
    if (summary) {
      tooltip.appendMarkdown(`\n\n${summary}`);
    }
    item.tooltip = tooltip;

    return item;
  }

  async _ensureBundle() {
    if (this.bundle) {
      return;
    }
    this.bundle = loadModelBundle(this.root, this.logger);
  }

  resolveSourceHint(moduleId) {
    if (!this.bundle) {
      return null;
    }
    return resolveSourceHint(this.bundle, moduleId);
  }
}

async function withManager(task, providers = []) {
  const root = getWorkspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage('ArchSync: open a workspace folder first.');
    return null;
  }

  for (const provider of providers) {
    provider?.setRoot(root);
  }

  const serviceManager = createManager(root);
  return task(serviceManager, root);
}

function register(context, command, handler) {
  context.subscriptions.push(vscode.commands.registerCommand(command, handler));
}

function ensureDecoration() {
  if (revealDecoration) {
    return revealDecoration;
  }
  revealDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    borderWidth: '0 0 0 2px',
    borderStyle: 'solid',
    borderColor: 'rgba(0, 160, 130, 0.9)',
    backgroundColor: 'rgba(0, 160, 130, 0.12)',
  });
  return revealDecoration;
}

async function revealSourceLocation(sourceHint) {
  const root = getWorkspaceRoot();
  if (!root) {
    vscode.window.showErrorMessage('ArchSync: open a workspace folder first.');
    return;
  }

  const relativePath = sourceHint?.path;
  if (!relativePath) {
    vscode.window.showWarningMessage('ArchSync: selected module has no source file.');
    return;
  }

  const absolutePath = sourceHint.absolutePath || path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    vscode.window.showWarningMessage(`ArchSync: source file not found: ${relativePath}`);
    return;
  }

  const line = Math.max(1, Number(sourceHint.line || 1));
  const uri = vscode.Uri.file(absolutePath);
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, { preview: false });

  const lineIndex = Math.min(line - 1, Math.max(0, document.lineCount - 1));
  const lineRange = document.lineAt(lineIndex).range;
  const anchor = new vscode.Position(lineIndex, 0);

  editor.selection = new vscode.Selection(anchor, anchor);
  editor.revealRange(lineRange, vscode.TextEditorRevealType.InCenter);

  const decoration = ensureDecoration();
  editor.setDecorations(decoration, [lineRange]);
  setTimeout(() => {
    try {
      editor.setDecorations(decoration, []);
    } catch {
      // ignore decoration cleanup failures
    }
  }, REVEAL_FLASH_MS);
}

function activate(context) {
  outputChannel = vscode.window.createOutputChannel('ArchSync');
  context.subscriptions.push(outputChannel);

  const sidebarProvider = new ArchSyncSidebarProvider(outputChannel);

  const treeView = vscode.window.createTreeView(MODULES_VIEW_ID, {
    treeDataProvider: sidebarProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  const root = getWorkspaceRoot();
  if (root) {
    sidebarProvider.setRoot(root);
  }

  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
    const nextRoot = getWorkspaceRoot();
    sidebarProvider.setRoot(nextRoot);
    sidebarProvider.refresh();
  }));

  context.subscriptions.push(treeView.onDidChangeSelection(async (event) => {
    const selected = event.selection?.[0];
    if (selected?.moduleId) {
      const sourceHint = sidebarProvider.resolveSourceHint(selected.moduleId);
      if (sourceHint) {
        await revealSourceLocation(sourceHint);
      }
    }
  }));

  register(context, 'archsync.refreshSidebar', async () => {
    const nextRoot = getWorkspaceRoot();
    sidebarProvider.setRoot(nextRoot);
    sidebarProvider.refresh();
  });

  register(context, 'archsync.revealModuleSource', async (sourceHintOrItem) => {
    let sourceHint = sourceHintOrItem;
    const moduleId = sourceHintOrItem?.moduleId || sourceHintOrItem?.id || '';
    if (!sourceHint?.path && moduleId) {
      sourceHint = sidebarProvider.resolveSourceHint(moduleId);
    }
    if (!sourceHint?.path) {
      vscode.window.showWarningMessage('ArchSync: no source location for selected module.');
      return;
    }
    await revealSourceLocation(sourceHint);
  });

  register(context, 'archsync.focusSidebar', async () => {
    await vscode.commands.executeCommand(ARCHSYNC_VIEW_CONTAINER_CMD);
    await vscode.commands.executeCommand('archsync.refreshSidebar');
  });

  register(context, 'archsync.rebuildSidebar', async () => {
    await withManager(async (serviceManager) => {
      outputChannel.show(true);
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'ArchSync: Rebuilding model for sidebar',
          cancellable: false,
        },
        async () => {
          await serviceManager.buildModel();
          sidebarProvider.refresh();
        },
      );
      vscode.window.showInformationMessage('ArchSync: sidebar updated.');
      return true;
    }, [sidebarProvider]);
  });

  register(context, 'archsync.buildModel', async () => {
    await withManager(async (serviceManager) => {
      outputChannel.show(true);
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'ArchSync: Building architecture model',
          cancellable: false,
        },
        async () => {
          const modelPath = await serviceManager.buildModel();
          const doc = await vscode.workspace.openTextDocument(modelPath);
          await vscode.window.showTextDocument(doc, { preview: false });
          sidebarProvider.refresh();
        },
      );
      vscode.window.showInformationMessage('ArchSync: build completed.');
      return true;
    }, [sidebarProvider]);
  });

  register(context, 'archsync.startServices', async () => {
    await withManager(async (serviceManager) => {
      outputChannel.show(true);
      const info = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'ArchSync: Starting services',
          cancellable: false,
        },
        async () => serviceManager.ensureServices(),
      );
      vscode.window.showInformationMessage(
        `ArchSync ready: backend ${info.backendUrl}, frontend ${info.frontendUrl}`,
      );
      return true;
    }, [sidebarProvider]);
  });

  register(context, 'archsync.stopServices', async () => {
    await withManager(async (serviceManager) => {
      await serviceManager.stopAll();
      vscode.window.showInformationMessage('ArchSync: services stopped.');
      return true;
    }, [sidebarProvider]);
  });

  register(context, 'archsync.openModelJson', async () => {
    await withManager(async (_serviceManager, workspaceRoot) => {
      const modelPath = path.join(workspaceRoot, 'docs', 'archsync', 'architecture.model.json');
      const uri = vscode.Uri.file(modelPath);
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch {
        vscode.window.showWarningMessage('ArchSync: model file not found, run "Build Architecture Model" first.');
      }
      return true;
    }, [sidebarProvider]);
  });

  register(context, 'archsync.openStudio', async () => {
    await withManager(async (serviceManager) => {
      outputChannel.show(true);
      const autoStart = getConfigValue('autoStartServices', true);

      let frontendUrl = serviceManager.frontendUrl();
      if (autoStart) {
        const info = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'ArchSync: Preparing Studio',
            cancellable: false,
          },
          async () => serviceManager.ensureServices(),
        );
        frontendUrl = info.frontendUrl;
      }

      const openExternal = getConfigValue('openExternalInsteadOfWebview', false);
      if (openExternal) {
        await vscode.env.openExternal(vscode.Uri.parse(frontendUrl));
        return true;
      }

      const panel = vscode.window.createWebviewPanel(
        'archsyncStudio',
        'ArchSync Studio',
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        },
      );

      panel.webview.html = panelHtml(frontendUrl);
      panel.webview.onDidReceiveMessage(async (message) => {
        if (message?.type === 'openExternal' && message.url) {
          await vscode.env.openExternal(vscode.Uri.parse(String(message.url)));
        }
      });

      return true;
    }, [sidebarProvider]);
  });

  context.subscriptions.push({
    dispose: () => {
      if (manager) {
        manager.stopAll().catch(() => {});
      }
      if (revealDecoration) {
        revealDecoration.dispose();
        revealDecoration = undefined;
      }
    },
  });
}

async function deactivate() {
  if (manager) {
    await manager.stopAll();
  }
  if (revealDecoration) {
    revealDecoration.dispose();
    revealDecoration = undefined;
  }
}

module.exports = {
  activate,
  deactivate,
};
