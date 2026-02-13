const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isHttpAvailable(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function getNewestFileMtimeMs(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return 0;
  }

  const queue = [rootDir];
  let newestMtimeMs = 0;

  while (queue.length > 0) {
    const currentDir = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      try {
        const mtimeMs = fs.statSync(entryPath).mtimeMs;
        if (mtimeMs > newestMtimeMs) {
          newestMtimeMs = mtimeMs;
        }
      } catch {
        // ignore file races while scanning tree
      }
    }
  }

  return newestMtimeMs;
}

function shouldBuildPreviewFrontend(frontendDir) {
  const srcDir = path.join(frontendDir, 'src');
  const distDir = path.join(frontendDir, 'dist');
  const distIndexPath = path.join(distDir, 'index.html');

  if (!fs.existsSync(distIndexPath)) {
    return true;
  }
  if (!fs.existsSync(srcDir)) {
    return false;
  }

  const newestSrcMtimeMs = getNewestFileMtimeMs(srcDir);
  if (newestSrcMtimeMs === 0) {
    return false;
  }

  const newestDistMtimeMs = getNewestFileMtimeMs(distDir);
  if (newestDistMtimeMs === 0) {
    return true;
  }

  return newestSrcMtimeMs > newestDistMtimeMs;
}

class ArchSyncServiceManager {
  constructor(options) {
    this.root = options.root;
    this.uvCommand = options.uvCommand || 'uv';
    this.npmCommand = options.npmCommand || 'npm';
    this.backendDir = options.backendDir || 'backend';
    this.frontendDir = options.frontendDir || 'frontend';
    this.engineDir = options.engineDir || 'tools/archsync';
    this.backendHost = options.backendHost || '127.0.0.1';
    this.backendPort = Number(options.backendPort || 9000);
    this.frontendHost = options.frontendHost || '127.0.0.1';
    this.frontendPort = Number(options.frontendPort || 5173);
    this.frontendMode = options.frontendMode || 'preview';
    this.logger = options.logger || { appendLine: () => {} };

    this.backendProcess = null;
    this.frontendProcess = null;
  }

  backendUrl() {
    return `http://${this.backendHost}:${this.backendPort}`;
  }

  frontendUrl() {
    return `http://${this.frontendHost}:${this.frontendPort}`;
  }

  backendHealthUrl() {
    return `${this.backendUrl()}/api/health`;
  }

  log(line) {
    this.logger.appendLine(`[archsync] ${line}`);
  }

  _spawnPersistent(command, args, options, label) {
    this.log(`spawn ${label}: ${command} ${args.join(' ')}`);
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk) => {
      this.log(`${label} ${String(chunk).trimEnd()}`);
    });
    child.stderr.on('data', (chunk) => {
      this.log(`${label} ${String(chunk).trimEnd()}`);
    });
    child.on('exit', (code) => {
      this.log(`${label} exited with code ${code}`);
      if (label === 'backend') {
        this.backendProcess = null;
      }
      if (label === 'frontend') {
        this.frontendProcess = null;
      }
    });

    return child;
  }

  async _runOnce(command, args, options, label) {
    this.log(`run ${label}: ${command} ${args.join(' ')}`);
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: process.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        const text = String(chunk);
        stdout += text;
        this.log(`${label} ${text.trimEnd()}`);
      });
      child.stderr.on('data', (chunk) => {
        const text = String(chunk);
        stderr += text;
        this.log(`${label} ${text.trimEnd()}`);
      });
      child.on('error', (error) => {
        reject(error);
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(new Error(`${label} failed with exit code ${code}\n${stderr || stdout}`));
      });
    });
  }

  async _waitFor(url, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await isHttpAvailable(url, 1200);
      if (ok) {
        return true;
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(300);
    }
    return false;
  }

  async buildModel() {
    const toolDir = path.join(this.root, this.engineDir);
    const args = [
      'run',
      '--directory',
      toolDir,
      'archsync',
      'build',
      '--repo',
      this.root,
      '--output',
      'docs/archsync',
      '--full',
    ];
    await this._runOnce(this.uvCommand, args, { cwd: this.root }, 'build');
    return path.join(this.root, 'docs', 'archsync', 'architecture.model.json');
  }

  async ensureBackend() {
    if (await isHttpAvailable(this.backendHealthUrl(), 1000)) {
      this.log(`backend already available at ${this.backendHealthUrl()}`);
      return { url: this.backendUrl(), startedByExtension: false };
    }

    if (!this.backendProcess) {
      const backendDir = path.join(this.root, this.backendDir);
      const args = [
        'run',
        '--directory',
        backendDir,
        'uvicorn',
        'main:app',
        '--host',
        this.backendHost,
        '--port',
        String(this.backendPort),
      ];
      this.backendProcess = this._spawnPersistent(this.uvCommand, args, { cwd: this.root }, 'backend');
    }

    const ok = await this._waitFor(this.backendHealthUrl(), 25000);
    if (!ok) {
      throw new Error(`backend not reachable: ${this.backendHealthUrl()}`);
    }
    return { url: this.backendUrl(), startedByExtension: true };
  }

  async ensureFrontend() {
    const url = this.frontendUrl();
    if (await isHttpAvailable(url, 1000)) {
      this.log(`frontend already available at ${url}`);
      return { url, startedByExtension: false };
    }

    if (!this.frontendProcess) {
      const frontendDir = path.join(this.root, this.frontendDir);
      if (this.frontendMode === 'preview') {
        if (shouldBuildPreviewFrontend(frontendDir)) {
          this.log('frontend dist is missing or stale; running build');
          await this._runOnce(
            this.npmCommand,
            ['--prefix', frontendDir, 'run', 'build'],
            { cwd: this.root },
            'frontend-build',
          );
        }
      }

      const script = this.frontendMode === 'dev' ? 'dev' : 'preview';
      const args = [
        '--prefix',
        frontendDir,
        'run',
        script,
        '--',
        '--host',
        this.frontendHost,
        '--port',
        String(this.frontendPort),
        '--strictPort',
      ];
      this.frontendProcess = this._spawnPersistent(this.npmCommand, args, { cwd: this.root }, 'frontend');
    }

    const ok = await this._waitFor(url, 30000);
    if (!ok) {
      throw new Error(`frontend not reachable: ${url}`);
    }
    return { url, startedByExtension: true };
  }

  async ensureServices() {
    const backend = await this.ensureBackend();
    const frontend = await this.ensureFrontend();
    return {
      backendUrl: backend.url,
      frontendUrl: frontend.url,
      startedBackend: backend.startedByExtension,
      startedFrontend: frontend.startedByExtension,
    };
  }

  async stopAll() {
    await Promise.all([
      this._stopChild(this.backendProcess, 'backend'),
      this._stopChild(this.frontendProcess, 'frontend'),
    ]);
    this.backendProcess = null;
    this.frontendProcess = null;
  }

  async _stopChild(child, label) {
    if (!child || child.killed) {
      return;
    }

    this.log(`stopping ${label}`);
    if (process.platform === 'win32') {
      child.kill('SIGTERM');
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }

    const exited = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 3500);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });

    if (!exited) {
      try {
        if (process.platform === 'win32') {
          child.kill('SIGKILL');
        } else {
          process.kill(-child.pid, 'SIGKILL');
        }
      } catch {
        // ignore
      }
    }
  }
}

module.exports = {
  ArchSyncServiceManager,
  isHttpAvailable,
  shouldBuildPreviewFrontend,
};
