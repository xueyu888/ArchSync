const assert = require('assert');
const {
  buildChildrenLookup,
  findSystemModule,
} = require('../model-utils');

describe('model utils', () => {
  it('finds explicit system module', () => {
    const modules = [
      { id: 'system', name: 'System', level: 0, parent_id: null },
      { id: 'layerA', name: 'LayerA', level: 1, parent_id: 'system' },
      { id: 'fileA', name: 'a.py', level: 2, parent_id: 'layerA' },
    ];

    const system = findSystemModule(modules);
    assert.strictEqual(system.id, 'system');
  });

  it('falls back to lowest-level module when explicit system is missing', () => {
    const modules = [
      { id: 'layerA', name: 'LayerA', level: 1, parent_id: null },
      { id: 'layerB', name: 'LayerB', level: 1, parent_id: null },
      { id: 'fileA', name: 'a.py', level: 2, parent_id: 'layerA' },
    ];
    const system = findSystemModule(modules);
    assert.strictEqual(system.id, 'layerA');
  });

  it('builds sorted children lookup by parent and level', () => {
    const modules = [
      { id: 'system', name: 'System', level: 0, parent_id: null },
      { id: 'layerB', name: 'LayerB', level: 1, parent_id: 'system' },
      { id: 'layerA', name: 'LayerA', level: 1, parent_id: 'system' },
      { id: 'file2', name: 'z.py', level: 2, parent_id: 'layerA' },
      { id: 'file1', name: 'a.py', level: 2, parent_id: 'layerA' },
    ];
    const childrenByParent = buildChildrenLookup(modules);
    const rootChildren = childrenByParent.get('system') || [];
    const layerAChildren = childrenByParent.get('layerA') || [];

    assert.deepStrictEqual(rootChildren.map((item) => item.id), ['layerA', 'layerB']);
    assert.deepStrictEqual(layerAChildren.map((item) => item.id), ['file1', 'file2']);
  });
});
