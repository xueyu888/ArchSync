const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('package manifest', () => {
  it('declares graph view as webview', () => {
    const manifestPath = path.join(__dirname, '..', 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    const views = manifest.contributes?.views?.archsync || [];
    const graph = views.find((item) => item.id === 'archsyncGraphView');

    assert.ok(graph, 'archsyncGraphView not found in contributes.views.archsync');
    assert.strictEqual(graph.type, 'webview');
  });
});
