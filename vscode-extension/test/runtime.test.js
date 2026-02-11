const assert = require('assert');
const fs = require('fs');
const net = require('net');
const path = require('path');

const { ArchSyncServiceManager, isHttpAvailable } = require('../runtime');

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
    server.on('error', reject);
  });
}

describe('ArchSync VSCode runtime', function suite() {
  this.timeout(300000);

  let manager;
  let backendPort;
  let frontendPort;

  afterEach(async () => {
    if (manager) {
      await manager.stopAll();
      manager = null;
    }
  });

  it('builds model and starts/stops services with custom ports', async () => {
    const root = path.resolve(__dirname, '..', '..');
    backendPort = await pickFreePort();
    frontendPort = await pickFreePort();

    manager = new ArchSyncServiceManager({
      root,
      backendHost: '127.0.0.1',
      backendPort,
      frontendHost: '127.0.0.1',
      frontendPort,
      frontendMode: 'preview',
      uvCommand: 'uv',
      npmCommand: 'npm',
      backendDir: 'backend',
      frontendDir: 'frontend',
      engineDir: 'tools/archsync',
      logger: { appendLine: () => {} },
    });

    const modelPath = await manager.buildModel();
    assert.ok(fs.existsSync(modelPath), 'architecture.model.json should exist after build');

    const services = await manager.ensureServices();
    assert.strictEqual(services.backendUrl, `http://127.0.0.1:${backendPort}`);
    assert.strictEqual(services.frontendUrl, `http://127.0.0.1:${frontendPort}`);

    const backendOk = await isHttpAvailable(`${services.backendUrl}/api/health`, 1500);
    const frontendOk = await isHttpAvailable(services.frontendUrl, 1500);
    assert.strictEqual(backendOk, true, 'backend health endpoint should be reachable');
    assert.strictEqual(frontendOk, true, 'frontend endpoint should be reachable');

    await manager.stopAll();

    const backendAfterStop = await isHttpAvailable(`${services.backendUrl}/api/health`, 1200);
    const frontendAfterStop = await isHttpAvailable(services.frontendUrl, 1200);
    assert.strictEqual(backendAfterStop, false, 'backend should stop after stopAll');
    assert.strictEqual(frontendAfterStop, false, 'frontend should stop after stopAll');
  });
});
