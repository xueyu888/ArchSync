const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ArchSyncServiceManager,
  shouldBuildPreviewFrontend,
} = require('../runtime');

function writeFile(filePath, content = 'x') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function touch(filePath, timestampMs) {
  const time = new Date(timestampMs);
  fs.utimesSync(filePath, time, time);
}

describe('ArchSync preview frontend freshness', () => {
  let tempRoot = '';

  afterEach(() => {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = '';
    }
  });

  function createFrontendTree() {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archsync-preview-'));
    const frontendDir = path.join(tempRoot, 'frontend');

    writeFile(path.join(frontendDir, 'src', 'App.jsx'), 'export default 1;');
    writeFile(path.join(frontendDir, 'dist', 'index.html'), '<!doctype html>');
    writeFile(path.join(frontendDir, 'dist', 'assets', 'index.js'), 'console.log(1);');

    return { frontendDir };
  }

  it('requests build when dist is missing', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archsync-preview-'));
    const frontendDir = path.join(tempRoot, 'frontend');
    writeFile(path.join(frontendDir, 'src', 'App.jsx'), 'export default 1;');

    assert.strictEqual(shouldBuildPreviewFrontend(frontendDir), true);
  });

  it('requests build when src is newer than dist', () => {
    const { frontendDir } = createFrontendTree();
    const oldMs = Date.parse('2026-01-01T00:00:00.000Z');
    const newMs = Date.parse('2026-01-02T00:00:00.000Z');

    touch(path.join(frontendDir, 'dist', 'index.html'), oldMs);
    touch(path.join(frontendDir, 'dist', 'assets', 'index.js'), oldMs);
    touch(path.join(frontendDir, 'src', 'App.jsx'), newMs);

    assert.strictEqual(shouldBuildPreviewFrontend(frontendDir), true);
  });

  it('skips build when dist is up to date', () => {
    const { frontendDir } = createFrontendTree();
    const oldMs = Date.parse('2026-01-01T00:00:00.000Z');
    const newMs = Date.parse('2026-01-02T00:00:00.000Z');

    touch(path.join(frontendDir, 'src', 'App.jsx'), oldMs);
    touch(path.join(frontendDir, 'dist', 'index.html'), newMs);
    touch(path.join(frontendDir, 'dist', 'assets', 'index.js'), newMs);

    assert.strictEqual(shouldBuildPreviewFrontend(frontendDir), false);
  });

  it('ensureFrontend rebuilds stale dist in preview mode', async () => {
    const { frontendDir } = createFrontendTree();
    const oldMs = Date.parse('2026-01-01T00:00:00.000Z');
    const newMs = Date.parse('2026-01-02T00:00:00.000Z');
    touch(path.join(frontendDir, 'dist', 'index.html'), oldMs);
    touch(path.join(frontendDir, 'dist', 'assets', 'index.js'), oldMs);
    touch(path.join(frontendDir, 'src', 'App.jsx'), newMs);

    const calls = [];
    const manager = new ArchSyncServiceManager({
      root: tempRoot,
      frontendDir: 'frontend',
      frontendHost: '127.0.0.1',
      frontendPort: 1,
      frontendMode: 'preview',
      logger: { appendLine: () => {} },
    });
    manager._runOnce = async (command, args, options, label) => {
      calls.push({ command, args, options, label });
      return { stdout: '', stderr: '' };
    };
    manager._spawnPersistent = (command, args, options, label) => {
      calls.push({ command, args, options, label });
      return { pid: process.pid, killed: false };
    };
    manager._waitFor = async () => true;

    await manager.ensureFrontend();

    const buildCall = calls.find((item) => item.label === 'frontend-build');
    assert.ok(buildCall, 'frontend-build should run when dist is stale');
    assert.deepStrictEqual(buildCall.args, ['--prefix', frontendDir, 'run', 'build']);
  });
});
