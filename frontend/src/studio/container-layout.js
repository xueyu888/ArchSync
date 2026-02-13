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
  const isLayerRootId = (moduleId) => String(moduleId || "").startsWith("layer:");
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
  // Include the full lineage for focus/expanded/selected nodes so we can render strict nested frames (Vivado-like).
  // Note: layer roots (`layer:*`) are treated as lane frames; we keep them in defs but can render them differently.
  for (const moduleId of focusPathIds || []) includeLineage(moduleId);
  for (const moduleId of expandedModuleIds || []) includeLineage(moduleId);
  if (selectedModuleId) includeLineage(selectedModuleId);
  if (!candidateIds.size && focusPathIds?.length) includeLineage(focusPathIds[focusPathIds.length - 1]);
  const rawCandidates = Array.from(candidateIds)
    .map((moduleId) => moduleById[moduleId] || visibleById[moduleId])
    .filter(Boolean)
    .sort((a, b) => a.level - b.level || `${a.layer}:${a.name}`.localeCompare(`${b.layer}:${b.name}`));
  const candidates = rawCandidates;
  const defIdSet = new Set(candidates.map((node) => node.id));

  function findParentContainerId(moduleId) {
    let current = moduleById[moduleId] || visibleById[moduleId] || null;
    if (!current) {
      return "";
    }
    let parent = current.parent_id ? moduleById[current.parent_id] || null : null;
    while (parent) {
      if (defIdSet.has(parent.id)) {
        return parent.id;
      }
      parent = parent.parent_id ? moduleById[parent.parent_id] || null : null;
    }
    return "";
  }

  // Assign each visible node to the nearest visible container ancestor (Vivado-style: each expansion level
  // wraps *its* immediate contents, not all descendants). This avoids overlapping frames and duplicate bounds.
  const memberIdsByContainerId = new Map();
  function addMember(containerId, memberId) {
    if (!containerId || !memberId) return;
    if (!memberIdsByContainerId.has(containerId)) {
      memberIdsByContainerId.set(containerId, new Set());
    }
    memberIdsByContainerId.get(containerId).add(memberId);
  }
  for (const node of visibleNodes) {
    // Never include a module "inside itself".
    let current = node.parent_id ? (moduleById[node.parent_id] || visibleById[node.parent_id] || null) : null;
    while (current) {
      if (defIdSet.has(current.id)) {
        addMember(current.id, node.id);
        break;
      }
      if (!current.parent_id) {
        break;
      }
      current = moduleById[current.parent_id] || null;
    }
  }

  const defsUnfiltered = candidates.map((node) => ({
    id: node.id,
    name: node.name,
    layer: node.layer,
    level: node.level,
    parentId: findParentContainerId(node.id),
    memberIds: Array.from(memberIdsByContainerId.get(node.id) || []),
  }));

  const childCountById = new Map();
  for (const def of defsUnfiltered) {
    if (!def.parentId) continue;
    childCountById.set(def.parentId, (childCountById.get(def.parentId) || 0) + 1);
  }

  const defs = defsUnfiltered.filter((def) => {
    if (def.memberIds.length) return true;
    if (childCountById.get(def.id)) return true;
    // Keep lane roots even when they currently contain only nested containers (or no nodes) so the overall
    // diagram still has stable layer frames when "Show Lanes" is off.
    if (isLayerRootId(def.id)) return true;
    // System root is allowed to exist as a wrapper even with only nested containers.
    if (String(def.id || "").startsWith("system:")) return true;
    return false;
  });

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
    // Vivado-style nesting needs consistent, modest margins; scaling margins too aggressively with
    // depth causes deep hierarchies to grow huge and collide with other lanes.
    const padX = 24;
    // Keep the top padding modest so nested frames "hug" their contents (Vivado-like).
    const padTop = 26;
    const padBottom = 24;
    let box = {
      id: def.id,
      name: def.name,
      layer: def.layer,
      level: def.level,
      parentId: def.parentId || "",
      x: minX - padX,
      y: minY - padTop,
      width: Math.max(220, maxX - minX + padX * 2),
      height: Math.max(160, maxY - minY + padTop + padBottom),
      memberCount: members.length,
    };
    // Parent frames should be visibly inset from children so the dashed borders don't merge.
    // Keep enough top/left inset so header chips and dashed borders never collide (Vivado-like nesting).
    const childInset = { top: 28, left: 28, right: 20, bottom: 20 };
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
