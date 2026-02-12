export function buildExpandedContainerDefs(
  nodes,
  focusPathIds,
  moduleById = {},
  expandedModuleIds = [],
  selectedModuleId = "",
) {
  const visibleNodes = nodes || [];
  const visibleById = Object.fromEntries(visibleNodes.map((item) => [item.id, item]));
  if (!visibleNodes.length) {
    return [];
  }
  const candidateIds = new Set();
  function includeLineage(moduleId) {
    let current = moduleById[moduleId] || visibleById[moduleId] || null;
    while (current) {
      candidateIds.add(current.id);
      if (!current.parent_id) {
        break;
      }
      current = moduleById[current.parent_id] || null;
    }
  }
  for (const moduleId of focusPathIds || []) includeLineage(moduleId);
  for (const moduleId of expandedModuleIds || []) includeLineage(moduleId);
  if (selectedModuleId) includeLineage(selectedModuleId);
  if (!candidateIds.size && focusPathIds?.length) includeLineage(focusPathIds[focusPathIds.length - 1]);
  const rawCandidates = Array.from(candidateIds)
    .map((moduleId) => moduleById[moduleId] || visibleById[moduleId])
    .filter(Boolean)
    .sort((a, b) => a.level - b.level || `${a.layer}:${a.name}`.localeCompare(`${b.layer}:${b.name}`));
  // Layer root nodes are already represented by the lane background.
  const candidates = rawCandidates.filter((item) => !String(item.id).startsWith("layer:"));
  const candidateIdSet = new Set(candidates.map((item) => item.id));
  const ancestryByNodeId = {};
  for (const node of visibleNodes) {
    const chain = new Set();
    let current = moduleById[node.id] || node;
    while (current) {
      chain.add(current.id);
      if (!current.parent_id) {
        break;
      }
      current = moduleById[current.parent_id] || null;
    }
    ancestryByNodeId[node.id] = chain;
  }
  const fallbackFocusId = focusPathIds?.length ? focusPathIds[focusPathIds.length - 1] : "";
  const defs = [];
  for (const node of candidates) {
    const moduleId = node.id;
    let parentId = "";
    let parent = node.parent_id ? moduleById[node.parent_id] : null;
    while (parent) {
      if (candidateIdSet.has(parent.id)) {
        parentId = parent.id;
        break;
      }
      parent = parent.parent_id ? moduleById[parent.parent_id] : null;
    }
    let memberIds = visibleNodes
      .filter((item) => item.id !== moduleId && ancestryByNodeId[item.id]?.has(moduleId))
      .map((item) => item.id);
    if (!memberIds.length) {
      memberIds = visibleNodes.filter((item) => item.parent_id === moduleId).map((item) => item.id);
    }
    if (!memberIds.length && moduleId === fallbackFocusId && visibleById[moduleId]) {
      memberIds = [moduleId];
    }
    if (!memberIds.length) {
      continue;
    }
    defs.push({
      id: node.id,
      name: node.name,
      layer: node.layer,
      level: node.level,
      parentId,
      memberIds,
    });
  }
  return defs;
}

export function materializeExpandedContainers(containerDefs, nodeById) {
  const defs = containerDefs || [];
  if (!defs.length) {
    return [];
  }
  const defById = Object.fromEntries(defs.map((def) => [def.id, def]));
  const childrenByParent = {};
  for (const def of defs) {
    if (!def.parentId || !defById[def.parentId]) {
      continue;
    }
    if (!childrenByParent[def.parentId]) {
      childrenByParent[def.parentId] = [];
    }
    childrenByParent[def.parentId].push(def.id);
  }
  const rootIds = defs
    .filter((def) => !def.parentId || !defById[def.parentId])
    .map((def) => def.id);
  const maxLevel = Math.max(...defs.map((def) => Number(def.level) || 0));
  const boxesById = {};
  function expandToContain(base, target, margins = 8) {
    const margin = typeof margins === "number" ? margins : 8;
    const marginTop = typeof margins === "object" ? (Number(margins.top) || 0) : margin;
    const marginRight = typeof margins === "object" ? (Number(margins.right) || 0) : margin;
    const marginBottom = typeof margins === "object" ? (Number(margins.bottom) || 0) : margin;
    const marginLeft = typeof margins === "object" ? (Number(margins.left) || 0) : margin;
    const minX = Math.min(base.x, target.x - marginLeft);
    const minY = Math.min(base.y, target.y - marginTop);
    const maxX = Math.max(base.x + base.width, target.x + target.width + marginRight);
    const maxY = Math.max(base.y + base.height, target.y + target.height + marginBottom);
    return {
      ...base,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }
  function computeBox(defId) {
    if (boxesById[defId]) {
      return boxesById[defId];
    }
    const def = defById[defId];
    if (!def) {
      return null;
    }
    const members = (def.memberIds || []).map((moduleId) => nodeById[moduleId]).filter(Boolean);
    const childBoxes = (childrenByParent[defId] || []).map((id) => computeBox(id)).filter(Boolean);
    const boundRects = [
      ...members.map((item) => ({ x: item.x, y: item.y, width: item.width, height: item.height })),
      ...childBoxes.map((item) => ({ x: item.x, y: item.y, width: item.width, height: item.height })),
    ];
    if (!boundRects.length) {
      return null;
    }
    const minX = Math.min(...boundRects.map((item) => item.x));
    const maxX = Math.max(...boundRects.map((item) => item.x + item.width));
    const minY = Math.min(...boundRects.map((item) => item.y));
    const maxY = Math.max(...boundRects.map((item) => item.y + item.height));
    const depthPad = Math.max(0, maxLevel - (Number(def.level) || 0));
    const padX = 18 + Math.min(56, depthPad * 9);
    const padTop = 26 + Math.min(52, depthPad * 8);
    const padBottom = 18 + Math.min(34, depthPad * 6);
    let box = {
      id: def.id,
      name: def.name,
      layer: def.layer,
      level: def.level,
      parentId: def.parentId || "",
      x: Math.max(8, minX - padX),
      y: Math.max(8, minY - padTop),
      width: Math.max(220, maxX - minX + padX * 2),
      height: Math.max(160, maxY - minY + padTop + padBottom),
      memberCount: members.length,
    };
    // In Vivado-style nesting, parent frames should be visibly inset from children so the title bars do not overlap.
    const childInset = { top: 26, left: 18, right: 10, bottom: 10 };
    for (const child of childBoxes) {
      box = expandToContain(box, child, childInset);
    }
    boxesById[defId] = box;
    return box;
  }
  for (const rootId of rootIds) {
    computeBox(rootId);
  }
  const containers = Object.values(boxesById).sort((a, b) => (
    a.level - b.level || (b.width * b.height) - (a.width * a.height)
  ));
  return containers;
}
