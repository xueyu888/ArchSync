function buildChildrenLookup(modules) {
  const output = new Map();
  for (const module of modules || []) {
    const parentId = module.parent_id || '__root__';
    if (!output.has(parentId)) {
      output.set(parentId, []);
    }
    output.get(parentId).push(module);
  }

  for (const [key, items] of output.entries()) {
    items.sort((a, b) => {
      if (a.level !== b.level) {
        return a.level - b.level;
      }
      return String(a.name).localeCompare(String(b.name));
    });
    output.set(key, items);
  }

  return output;
}

function findSystemModule(modules) {
  const list = modules || [];
  const explicit = list.find((item) => item.level === 0 && !item.parent_id);
  if (explicit) {
    return explicit;
  }
  if (!list.length) {
    return null;
  }
  const sorted = [...list].sort((a, b) => a.level - b.level || String(a.name).localeCompare(String(b.name)));
  return sorted[0];
}

function lineage(moduleId, moduleById) {
  const output = [];
  let current = moduleById.get(moduleId);
  while (current) {
    output.push(current);
    if (!current.parent_id) {
      break;
    }
    current = moduleById.get(current.parent_id) || null;
  }
  return output.reverse();
}

function representativeUnderParent(moduleId, parentId, moduleById, visibleIds) {
  let current = moduleById.get(moduleId);
  while (current) {
    if (current.parent_id === parentId && visibleIds.has(current.id)) {
      return current;
    }
    if (!current.parent_id) {
      return null;
    }
    current = moduleById.get(current.parent_id) || null;
  }
  return null;
}

function addOrMergeEdge(edgeMap, payload) {
  const { srcId, dstId, kind, label } = payload;
  const key = `${srcId}|${dstId}|${kind}`;
  if (!edgeMap.has(key)) {
    edgeMap.set(key, {
      id: key,
      src_id: srcId,
      dst_id: dstId,
      kind,
      count: 0,
      labels: new Set(),
    });
  }

  const edge = edgeMap.get(key);
  edge.count += 1;
  if (label) {
    edge.labels.add(label);
  }
}

function formatEdgeLabel(rawEdge) {
  const labels = Array.from(rawEdge.labels || []).filter(Boolean).sort();
  if (!labels.length) {
    return rawEdge.kind;
  }
  if (labels.length > 2) {
    return `${labels.slice(0, 2).join(' / ')} +${labels.length - 2}`;
  }
  return labels.join(' / ');
}

function collectViewGraph(model, currentParentId, childrenByParent, moduleById) {
  if (!model || !currentParentId) {
    return { nodes: [], edges: [] };
  }

  const nodes = [...(childrenByParent.get(currentParentId) || [])];
  const visibleIds = new Set(nodes.map((item) => item.id));
  const edgeMap = new Map();

  for (const edge of model.edges || []) {
    const src = representativeUnderParent(edge.src_id, currentParentId, moduleById, visibleIds);
    const dst = representativeUnderParent(edge.dst_id, currentParentId, moduleById, visibleIds);
    if (!src || !dst || src.id === dst.id) {
      continue;
    }

    addOrMergeEdge(edgeMap, {
      srcId: src.id,
      dstId: dst.id,
      kind: edge.kind,
      label: edge.label,
    });
  }

  const edges = Array.from(edgeMap.values())
    .map((rawEdge) => ({
      id: rawEdge.id,
      src_id: rawEdge.src_id,
      dst_id: rawEdge.dst_id,
      kind: rawEdge.kind,
      label: formatEdgeLabel(rawEdge),
      count: rawEdge.count,
    }))
    .sort((a, b) => `${a.kind}:${a.src_id}:${a.dst_id}`.localeCompare(`${b.kind}:${b.src_id}:${b.dst_id}`));

  return { nodes, edges };
}

module.exports = {
  buildChildrenLookup,
  collectViewGraph,
  findSystemModule,
  lineage,
};
