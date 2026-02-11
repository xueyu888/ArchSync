const assert = require('assert');
const {
  buildChildrenLookup,
  collectViewGraph,
  findSystemModule,
  lineage,
} = require('../model-utils');

describe('model utils', () => {
  it('finds system module and lineage correctly', () => {
    const modules = [
      { id: 'system', name: 'System', level: 0, parent_id: null },
      { id: 'layerA', name: 'LayerA', level: 1, parent_id: 'system' },
      { id: 'fileA', name: 'a.py', level: 2, parent_id: 'layerA' },
    ];
    const moduleById = new Map(modules.map((item) => [item.id, item]));

    const system = findSystemModule(modules);
    assert.strictEqual(system.id, 'system');

    const chain = lineage('fileA', moduleById);
    assert.deepStrictEqual(chain.map((item) => item.id), ['system', 'layerA', 'fileA']);
  });

  it('aggregates edges at current depth', () => {
    const modules = [
      { id: 'system', name: 'System', level: 0, parent_id: null },
      { id: 'layerA', name: 'LayerA', level: 1, parent_id: 'system' },
      { id: 'layerB', name: 'LayerB', level: 1, parent_id: 'system' },
      { id: 'a1', name: 'a1.py', level: 2, parent_id: 'layerA' },
      { id: 'a2', name: 'a2.py', level: 2, parent_id: 'layerA' },
      { id: 'b1', name: 'b1.py', level: 2, parent_id: 'layerB' },
    ];
    const model = {
      modules,
      edges: [
        { src_id: 'a1', dst_id: 'b1', kind: 'dependency', label: 'import x' },
        { src_id: 'a2', dst_id: 'b1', kind: 'dependency', label: 'import y' },
      ],
    };

    const childrenByParent = buildChildrenLookup(modules);
    const moduleById = new Map(modules.map((item) => [item.id, item]));

    const view = collectViewGraph(model, 'system', childrenByParent, moduleById);
    assert.strictEqual(view.nodes.length, 2);
    assert.strictEqual(view.edges.length, 1);
    assert.strictEqual(view.edges[0].src_id, 'layerA');
    assert.strictEqual(view.edges[0].dst_id, 'layerB');
    assert.strictEqual(view.edges[0].count, 2);
  });
});
