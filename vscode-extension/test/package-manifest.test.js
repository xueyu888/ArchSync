const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('package manifest', () => {
  it('keeps modules tree view and studio command only', () => {
    const manifestPath = path.join(__dirname, '..', 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    const views = manifest.contributes?.views?.archsync || [];
    const modules = views.find((item) => item.id === 'archsyncModulesView');
    const graph = views.find((item) => item.id === 'archsyncGraphView');
    const commands = manifest.contributes?.commands || [];
    const openStudio = commands.find((item) => item.command === 'archsync.openStudio');
    const openGraphPane = commands.find((item) => item.command === 'archsync.openGraphPane');
    const focusGraph = commands.find((item) => item.command === 'archsync.focusGraph');

    assert.ok(modules, 'archsyncModulesView not found in contributes.views.archsync');
    assert.ok(!graph, 'archsyncGraphView should be removed from sidebar views');
    assert.ok(openStudio, 'archsync.openStudio command not found');
    assert.ok(!openGraphPane, 'archsync.openGraphPane should be removed');
    assert.ok(!focusGraph, 'archsync.focusGraph should be removed');
  });
});
