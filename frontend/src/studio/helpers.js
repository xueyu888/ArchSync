export function clip(text, maxLength) {
  if (!text) {
    return "";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
export function charUnits(ch) {
  if (!ch) {
    return 0;
  }
  if (/\s/.test(ch)) {
    return 0.45;
  }
  const cp = ch.codePointAt(0) || 0;
  if (cp <= 0x7f) {
    return 0.62;
  }
  if (cp >= 0x2e80) {
    return 1;
  }
  return 0.82;
}
export function textUnits(text) {
  return Array.from(String(text || "")).reduce((sum, ch) => sum + charUnits(ch), 0);
}
export function clipByUnits(text, maxUnits) {
  const source = String(text || "");
  if (!source || maxUnits <= 0) {
    return "";
  }
  let used = 0;
  let out = "";
  for (const ch of Array.from(source)) {
    const unit = charUnits(ch);
    if (used + unit > maxUnits) {
      return `${out.trimEnd()}…`;
    }
    out += ch;
    used += unit;
  }
  return out;
}
export function wrapTextByUnits(text, maxUnits, maxLines = 4) {
  const source = String(text || "").trim();
  if (!source || maxUnits <= 0 || maxLines <= 0) {
    return { lines: [], truncated: false };
  }
  const hardLines = source.split(/\r?\n/);
  const lines = [];
  let truncated = false;
  for (const hardLine of hardLines) {
    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }
    let current = "";
    let used = 0;
    for (const ch of Array.from(hardLine)) {
      const unit = charUnits(ch);
      if (used + unit > maxUnits && current) {
        lines.push(current.trimEnd());
        if (lines.length >= maxLines) {
          truncated = true;
          break;
        }
        current = ch;
        used = unit;
      } else {
        current += ch;
        used += unit;
      }
    }
    if (truncated) {
      break;
    }
    if (current.trim()) {
      lines.push(current.trimEnd());
    }
  }
  if (lines.length > maxLines) {
    lines.length = maxLines;
    truncated = true;
  }
  if (truncated && lines.length) {
    lines[lines.length - 1] = clipByUnits(lines[lines.length - 1], Math.max(2, maxUnits - 1));
  }
  return { lines, truncated };
}
export function formatPortText(port) {
  return `${port.protocol || ""} ${port.name || ""}`.trim();
}
export function isInterfaceProtocol(protocol) {
  const value = String(protocol || "").toLowerCase();
  if (!value) {
    return false;
  }
  return ["axi", "stream", "bus", "rpc", "http", "grpc", "mq", "topic", "socket", "i2c", "spi", "irq"]
    .some((token) => value.includes(token));
}
export function buildNodeVisual(node, ports, summaryText, summarySource) {
  const inPorts = ports.filter((item) => String(item.direction).toLowerCase() === "in");
  const outPorts = ports.filter((item) => String(item.direction).toLowerCase() === "out");
  const maxVisiblePorts = 6;
  const displayInPorts = inPorts.slice(0, maxVisiblePorts);
  const displayOutPorts = outPorts.slice(0, maxVisiblePorts);
  const inOverflow = Math.max(0, inPorts.length - displayInPorts.length);
  const outOverflow = Math.max(0, outPorts.length - displayOutPorts.length);
  const portCandidates = [
    ...displayInPorts.map((port) => `IN ${formatPortText(port)}`),
    ...displayOutPorts.map((port) => `OUT ${formatPortText(port)}`),
    inOverflow ? `IN +${inOverflow} more` : "",
    outOverflow ? `OUT +${outOverflow} more` : "",
  ].filter(Boolean);
  const titleUnits = textUnits(node.name);
  const summaryUnits = textUnits(summaryText);
  const portUnits = Math.max(0, ...portCandidates.map((item) => textUnits(item)));
  const widthFromTitle = 160 + titleUnits * 5.4;
  const widthFromPorts = 138 + portUnits * 5.2;
  const widthFromSummary = summaryText ? 182 + Math.min(220, summaryUnits * 3.2) : 250;
  const width = Math.round(Math.min(460, Math.max(250, widthFromTitle, widthFromPorts, widthFromSummary)));
  const summaryMaxUnits = Math.max(18, Math.floor((width - 36) / 7.2));
  const { lines: summaryLines } = wrapTextByUnits(summaryText, summaryMaxUnits, 4);
  const summaryLineHeight = 14;
  const summaryBlockHeight = summaryLines.length ? summaryLines.length * summaryLineHeight + 8 : 0;
  const displayInCount = displayInPorts.length + (inOverflow ? 1 : 0);
  const displayOutCount = displayOutPorts.length + (outOverflow ? 1 : 0);
  const portRows = Math.max(displayInCount, displayOutCount, 1);
  const portRowHeight = 16;
  const portStartOffset = summaryLines.length ? 80 + summaryBlockHeight : 74;
  const height = Math.round(Math.max(112, portStartOffset + portRows * portRowHeight + 16));
  const portTextUnits = Math.max(10, Math.floor((width - 54) / 6.4));
  return {
    width,
    height,
    inPorts,
    outPorts,
    displayInPorts,
    displayOutPorts,
    inOverflow,
    outOverflow,
    summary: summaryText,
    summaryLines,
    summarySource: summaryText ? (summarySource || "fallback") : "",
    summaryY: 66,
    portStartOffset,
    portTextUnits,
  };
}
export function nowTimeLabel() {
  return new Date().toLocaleTimeString([], { hour12: false });
}
export function humanizeKind(kind) {
  return String(kind || "dependency")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}
export function buildModuleLookup(modules) {
  return Object.fromEntries(modules.map((item) => [item.id, item]));
}
export function buildChildrenLookup(modules) {
  const output = {};
  for (const module of modules) {
    const parentId = module.parent_id || "__root__";
    if (!output[parentId]) {
      output[parentId] = [];
    }
    output[parentId].push(module);
  }
  for (const key of Object.keys(output)) {
    output[key] = output[key].sort((a, b) => {
      if (a.level !== b.level) {
        return a.level - b.level;
      }
      return a.name.localeCompare(b.name);
    });
  }
  return output;
}
export function buildEvidenceLookup(evidences) {
  return Object.fromEntries((evidences || []).map((item) => [item.id, item]));
}
export function buildDescendantsLookup(modules) {
  const children = {};
  for (const module of modules) {
    const parentId = module.parent_id || "__root__";
    if (!children[parentId]) {
      children[parentId] = [];
    }
    children[parentId].push(module.id);
  }
  const memo = {};
  const walk = (moduleId) => {
    if (memo[moduleId]) {
      return memo[moduleId];
    }
    const result = new Set([moduleId]);
    for (const childId of children[moduleId] || []) {
      const childSet = walk(childId);
      for (const item of childSet) {
        result.add(item);
      }
    }
    memo[moduleId] = result;
    return result;
  };
  for (const module of modules) {
    walk(module.id);
  }
  return memo;
}
export function lineage(moduleId, moduleById) {
  const output = [];
  let current = moduleById[moduleId];
  while (current) {
    output.push(current);
    if (!current.parent_id) {
      break;
    }
    current = moduleById[current.parent_id] || null;
  }
  return output.reverse();
}
export function addOrMergeEdge(edgeMap, payload) {
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
export function formatEdgeLabel(rawEdge) {
  const labels = Array.from(rawEdge.labels || []).filter(Boolean).sort();
  const readable = labels.length
    ? labels.length > 2
      ? `${labels.slice(0, 2).join(" / ")} +${labels.length - 2}`
      : labels.join(" / ")
    : humanizeKind(rawEdge.kind);
  if (rawEdge.count > 1) {
    return `${readable} ×${rawEdge.count}`;
  }
  return readable;
}
export function ensureSet(items) {
  if (items instanceof Set) {
    return items;
  }
  return new Set(items || []);
}
export function hasChildrenInLookup(moduleId, childrenByParent) {
  return (childrenByParent[moduleId] || []).length > 0;
}
export function setsEqual(left, right) {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.size !== right.size) {
    return false;
  }
  for (const item of left) {
    if (!right.has(item)) {
      return false;
    }
  }
  return true;
}
export function withFocusPathExpanded(expandedModuleIds, focusModuleId, childrenByParent, moduleById, rootModuleId, options = {}) {
  const includeSelf = options.includeSelf === true;
  const next = new Set(expandedModuleIds || []);
  if (focusModuleId && moduleById[focusModuleId]) {
    const chain = lineage(focusModuleId, moduleById);
    const lastIndex = chain.length - 1;
    chain.forEach((item, index) => {
      if (!includeSelf && index === lastIndex) {
        return;
      }
      if (hasChildrenInLookup(item.id, childrenByParent)) {
        next.add(item.id);
      }
    });
  }
  if (rootModuleId && hasChildrenInLookup(rootModuleId, childrenByParent)) {
    next.add(rootModuleId);
  }
  return next;
}
export function collapseExpandedSubtree(expandedModuleIds, moduleId, childrenByParent, rootModuleId) {
  const next = new Set(expandedModuleIds || []);
  const queue = [moduleId];
  const visited = new Set();
  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);
    next.delete(currentId);
    for (const child of childrenByParent[currentId] || []) {
      queue.push(child.id);
    }
  }
  if (rootModuleId && hasChildrenInLookup(rootModuleId, childrenByParent)) {
    next.add(rootModuleId);
  }
  return next;
}
export function representativeInVisibleSet(moduleId, moduleById, visibleIds) {
  let current = moduleById[moduleId];
  while (current) {
    if (visibleIds.has(current.id)) {
      return current;
    }
    if (!current.parent_id) {
      return null;
    }
    current = moduleById[current.parent_id] || null;
  }
  return null;
}
export function collectSemanticViewGraph(model, focusModuleId, childrenByParent, moduleById, expandedModuleIds) {
  if (!model || !focusModuleId || !moduleById[focusModuleId]) {
    return {
      rootId: "",
      focusPathIds: [],
      nodes: [],
      edges: [],
    };
  }
  const expandedSet = ensureSet(expandedModuleIds);
  const focusPath = lineage(focusModuleId, moduleById);
  const focusPathIds = focusPath.map((item) => item.id);
  const focusPathIdSet = new Set(focusPathIds);
  const rootId = focusPath[0]?.id || focusModuleId;
  let visibleIds = new Set();
  for (const child of childrenByParent[focusModuleId] || []) {
    visibleIds.add(child.id);
  }
  if (!visibleIds.size) {
    visibleIds.add(focusModuleId);
  }
  let changed = true;
  let pass = 0;
  while (changed && pass < 8) {
    changed = false;
    pass += 1;
    const nextVisible = new Set(visibleIds);
    for (const moduleId of Array.from(visibleIds)) {
      if (!expandedSet.has(moduleId)) {
        continue;
      }
      const childModules = childrenByParent[moduleId] || [];
      if (!childModules.length) {
        continue;
      }
      let appended = false;
      for (const child of childModules) {
        if (!nextVisible.has(child.id)) {
          nextVisible.add(child.id);
          appended = true;
        }
      }
      if (nextVisible.delete(moduleId) || appended) {
        changed = true;
      }
    }
    if (changed) {
      visibleIds = nextVisible;
    }
  }
  const nodes = Array.from(visibleIds)
    .map((moduleId) => moduleById[moduleId])
    .filter(Boolean)
    .map((module) => {
      let contextKind = "context";
      if (module.id === focusModuleId) {
        contextKind = "focus";
      } else if (module.parent_id === focusModuleId) {
        contextKind = "focus";
      } else if (focusPathIdSet.has(module.id)) {
        contextKind = "path";
      } else if (expandedSet.has(module.id)) {
        contextKind = "expanded";
      }
      return {
        ...module,
        contextKind,
      };
    })
    .sort((a, b) => (
      a.level - b.level
      || `${a.layer}:${a.name}`.localeCompare(`${b.layer}:${b.name}`)
    ));
  const outerStatsByNode = new Map();
  function ensureOuterStats(moduleId) {
    if (!outerStatsByNode.has(moduleId)) {
      outerStatsByNode.set(moduleId, {
        inParentIds: new Set(),
        outParentIds: new Set(),
        inEdgeCount: 0,
        outEdgeCount: 0,
      });
    }
    return outerStatsByNode.get(moduleId);
  }
  const edgeMap = new Map();
  for (const edge of model.edges || []) {
    const srcVisible = visibleIds.has(edge.src_id);
    const dstVisible = visibleIds.has(edge.dst_id);
    const src = representativeInVisibleSet(edge.src_id, moduleById, visibleIds);
    const dst = representativeInVisibleSet(edge.dst_id, moduleById, visibleIds);
    if (!src || !dst || src.id === dst.id) {
      continue;
    }
    addOrMergeEdge(edgeMap, {
      srcId: src.id,
      dstId: dst.id,
      kind: edge.kind,
      label: edge.label,
    });
    if (!srcVisible || !dstVisible) {
      const srcStats = ensureOuterStats(src.id);
      srcStats.outParentIds.add(dst.id);
      srcStats.outEdgeCount += 1;
      const dstStats = ensureOuterStats(dst.id);
      dstStats.inParentIds.add(src.id);
      dstStats.inEdgeCount += 1;
    }
  }
  const edges = Array.from(edgeMap.values())
    .map((rawEdge) => ({
      raw_labels: Array.from(rawEdge.labels || []).filter(Boolean).sort(),
      id: rawEdge.id,
      src_id: rawEdge.src_id,
      dst_id: rawEdge.dst_id,
      kind: rawEdge.kind,
      label: formatEdgeLabel(rawEdge),
      count: rawEdge.count,
    }))
    .sort((a, b) => `${a.kind}:${a.src_id}:${a.dst_id}`.localeCompare(`${b.kind}:${b.src_id}:${b.dst_id}`));
  const nodesWithStats = nodes.map((node) => {
    const stats = outerStatsByNode.get(node.id);
    const outerInParentIds = stats ? Array.from(stats.inParentIds).sort() : [];
    const outerOutParentIds = stats ? Array.from(stats.outParentIds).sort() : [];
    return {
      ...node,
      outerInParentIds,
      outerOutParentIds,
      outerInParentCount: outerInParentIds.length,
      outerOutParentCount: outerOutParentIds.length,
      outerInEdgeCount: stats ? stats.inEdgeCount : 0,
      outerOutEdgeCount: stats ? stats.outEdgeCount : 0,
    };
  });
  return {
    rootId,
    focusPathIds,
    nodes: nodesWithStats,
    edges,
  };
}
export function computeLayerGraphHints(nodes, edges) {
  const nodeIds = nodes.map((node) => node.id);
  const nodeSet = new Set(nodeIds);
  const incoming = Object.fromEntries(nodeIds.map((id) => [id, []]));
  const outgoing = Object.fromEntries(nodeIds.map((id) => [id, []]));
  for (const edge of edges || []) {
    if (!nodeSet.has(edge.src_id) || !nodeSet.has(edge.dst_id) || edge.src_id === edge.dst_id) {
      continue;
    }
    outgoing[edge.src_id].push(edge.dst_id);
    incoming[edge.dst_id].push(edge.src_id);
  }
  const rankMemo = {};
  function rankOf(nodeId, visiting = new Set()) {
    if (rankMemo[nodeId] !== undefined) {
      return rankMemo[nodeId];
    }
    if (visiting.has(nodeId)) {
      return 0;
    }
    visiting.add(nodeId);
    let best = 0;
    for (const prevId of incoming[nodeId]) {
      best = Math.max(best, rankOf(prevId, visiting) + 1);
    }
    visiting.delete(nodeId);
    rankMemo[nodeId] = best;
    return best;
  }
  for (const nodeId of nodeIds) {
    rankOf(nodeId);
  }
  const degree = {};
  for (const nodeId of nodeIds) {
    degree[nodeId] = incoming[nodeId].length + outgoing[nodeId].length;
  }
  return { rank: rankMemo, degree, incoming, outgoing };
}
export function buildCenterOutOrder(count) {
  if (count <= 1) {
    return [0];
  }
  const middle = (count - 1) / 2;
  return Array.from({ length: count }, (_, index) => index)
    .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle) || a - b);
}
export function buildExpandedContainerDefs(nodes, focusPathIds, moduleById = {}, expandedModuleIds = [], selectedModuleId = "") {
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
  for (const moduleId of focusPathIds || []) {
    includeLineage(moduleId);
  }
  for (const moduleId of expandedModuleIds || []) {
    includeLineage(moduleId);
  }
  if (selectedModuleId) {
    includeLineage(selectedModuleId);
  }
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
  for (const moduleId of candidateIds) {
    const node = moduleById[moduleId] || visibleById[moduleId];
    if (!node) {
      continue;
    }
    let memberIds = visibleNodes
      .filter((item) => item.id !== moduleId && ancestryByNodeId[item.id]?.has(moduleId))
      .map((item) => item.id);
    const directVisibleChildren = visibleNodes
      .filter((item) => item.parent_id === moduleId)
      .map((item) => item.id);
    if (!memberIds.length && directVisibleChildren.length) {
      memberIds = directVisibleChildren;
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
      memberIds,
    });
  }
  return defs.sort((a, b) => (
    a.level - b.level
    || `${a.layer}:${a.name}`.localeCompare(`${b.layer}:${b.name}`)
  ));
}
export function materializeExpandedContainers(containerDefs, nodeById, lanes = []) {
  const laneByLayer = Object.fromEntries((lanes || []).map((lane) => [lane.layer, lane]));
  const defs = containerDefs || [];
  if (!defs.length) {
    return [];
  }
  const maxLevel = Math.max(...defs.map((def) => Number(def.level) || 0));
  const containers = [];
  for (const def of defs) {
    const members = def.memberIds
      .map((moduleId) => nodeById[moduleId])
      .filter(Boolean);
    if (!members.length) {
      continue;
    }
    const minX = Math.min(...members.map((item) => item.x));
    const maxX = Math.max(...members.map((item) => item.x + item.width));
    const minY = Math.min(...members.map((item) => item.y));
    const maxY = Math.max(...members.map((item) => item.y + item.height));
    const depthPad = Math.max(0, maxLevel - (Number(def.level) || 0));
    const padX = 20 + Math.min(48, depthPad * 8);
    const padTop = 28 + Math.min(42, depthPad * 8);
    const padBottom = 18 + Math.min(30, depthPad * 6);
    const lane = laneByLayer[def.layer];
    const laneTopMin = lane ? lane.y + 44 : 8;
    const x = Math.max(8, minX - padX);
    const y = Math.max(laneTopMin, minY - padTop);
    const width = Math.max(220, maxX - minX + padX * 2);
    const height = Math.max(160, maxY - minY + padTop + padBottom);
    const box = {
      id: def.id,
      name: def.name,
      layer: def.layer,
      level: def.level,
      x,
      y,
      width,
      height,
      memberCount: members.length,
    };
    containers.push(box);
  }
  return containers.sort((a, b) => (
    a.level - b.level
    || (b.width * b.height) - (a.width * a.height)
  ));
}
export function boundsWithPadding(layout, nodes, lanes, moduleContainers) {
  const candidates = [
    ...nodes.map((item) => ({ x: item.x, y: item.y, width: item.width, height: item.height })),
    ...lanes.map((item) => ({ x: item.x, y: item.y, width: item.width, height: item.height })),
    ...(moduleContainers || []).map((item) => ({ x: item.x, y: item.y, width: item.width, height: item.height })),
  ];
  if (!candidates.length) {
    return {
      width: layout.width,
      height: layout.height,
    };
  }
  const maxX = Math.max(...candidates.map((item) => item.x + item.width));
  const maxY = Math.max(...candidates.map((item) => item.y + item.height));
  return {
    width: Math.max(layout.width, maxX + 140),
    height: Math.max(layout.height, maxY + 140),
  };
}
export function layoutGraph(
  nodes,
  edges,
  portsByModule,
  summaryByModule = {},
  summarySourceByModule = {},
  moduleById = {},
  focusPathIds = [],
  expandedModuleIds = [],
  selectedModuleId = "",
) {
  const groups = new Map();
  for (const node of nodes) {
    if (!groups.has(node.layer)) {
      groups.set(node.layer, []);
    }
    groups.get(node.layer).push(node);
  }
  const layers = Array.from(groups.keys());
  const minLaneWidth = 380;
  const laneGap = 96;
  const top = 84;
  const left = 76;
  const laneHeader = 58;
  const lanePadding = 28;
  const columnGap = 64;
  const drawNodes = [];
  const lanes = [];
  let maxHeight = 500;
  let totalWidth = left;
  for (let col = 0; col < layers.length; col += 1) {
    const layer = layers[col];
    const rawNodes = [...groups.get(layer)];
    const {
      rank: rawRankById,
      degree: degreeById,
      incoming: incomingById,
      outgoing: outgoingById,
    } = computeLayerGraphHints(rawNodes, edges);
    const visualById = {};
    let maxNodeWidth = 260;
    for (const node of rawNodes) {
      const ports = portsByModule[node.id] || [];
      const summary = (summaryByModule[node.id] || "").trim();
      const source = summary ? (summarySourceByModule[node.id] || "fallback") : "";
      const visual = buildNodeVisual(node, ports, summary, source);
      visualById[node.id] = visual;
      maxNodeWidth = Math.max(maxNodeWidth, visual.width);
    }
    const rankLevels = Array.from(new Set(rawNodes.map((node) => rawRankById[node.id] || 0))).sort((a, b) => a - b);
    const informativeRanks = rankLevels.length > 1;
    const densityColumnCount = Math.min(5, Math.max(2, Math.ceil(Math.sqrt(Math.max(1, rawNodes.length) / 2))));
    const columnCount = informativeRanks
      ? Math.min(6, rankLevels.length)
      : (rawNodes.length <= 4 ? 1 : densityColumnCount);
    const rankColumnByValue = {};
    if (informativeRanks) {
      const maxRankIndex = Math.max(1, rankLevels.length - 1);
      const maxColumnIndex = Math.max(1, columnCount - 1);
      rankLevels.forEach((rankValue, rankIndex) => {
        rankColumnByValue[rankValue] = Math.round((rankIndex / maxRankIndex) * maxColumnIndex);
      });
    }
    const laneWidth = Math.max(
      minLaneWidth,
      lanePadding * 2 + columnCount * maxNodeWidth + (columnCount - 1) * columnGap,
    );
    const laneX = totalWidth;
    totalWidth += laneWidth + laneGap;
    const columns = Array.from({ length: columnCount }, () => []);
    const preferredColumnById = {};
    const centerOutOrder = buildCenterOutOrder(columnCount);
    const sortableNodes = [...rawNodes].sort((a, b) => {
      const rankGap = informativeRanks
        ? ((rawRankById[a.id] || 0) - (rawRankById[b.id] || 0))
        : 0;
      if (rankGap !== 0) {
        return rankGap;
      }
      return (degreeById[b.id] || 0) - (degreeById[a.id] || 0) || a.name.localeCompare(b.name);
    });
    sortableNodes.forEach((node, index) => {
      let preferred = 0;
      if (columnCount > 1) {
        if (informativeRanks) {
          preferred = rankColumnByValue[rawRankById[node.id] || 0] || 0;
        } else {
          preferred = centerOutOrder[index % centerOutOrder.length];
        }
      }
      preferredColumnById[node.id] = preferred;
      let bestColumn = preferred;
      let bestScore = Number.POSITIVE_INFINITY;
      const linkedColumns = [...(incomingById[node.id] || []), ...(outgoingById[node.id] || [])]
        .map((neighborId) => preferredColumnById[neighborId])
        .filter(Number.isFinite);
      for (let i = 0; i < columnCount; i += 1) {
        const distancePenalty = Math.abs(i - preferred) * 0.8;
        const occupancyPenalty = columns[i].length * 1.05;
        const relationPenalty = linkedColumns.length
          ? linkedColumns.reduce((sum, columnIndex) => sum + Math.abs(i - columnIndex), 0) / linkedColumns.length
          : 0;
        const score = occupancyPenalty + distancePenalty + relationPenalty * 0.65;
        if (score < bestScore) {
          bestScore = score;
          bestColumn = i;
        }
      }
      columns[bestColumn].push(node);
    });
    const columnByNodeId = {};
    columns.forEach((columnNodes, columnIndex) => {
      columnNodes.forEach((node) => {
        columnByNodeId[node.id] = columnIndex;
      });
    });
    const rowIndexById = {};
    function refreshRowIndex() {
      columns.forEach((columnNodes) => {
        columnNodes.forEach((node, rowIndex) => {
          rowIndexById[node.id] = rowIndex;
        });
      });
    }
    function barycenter(nodeId, direction) {
      const currentColumn = columnByNodeId[nodeId];
      const linked = direction === "incoming"
        ? (incomingById[nodeId] || [])
        : direction === "outgoing"
          ? (outgoingById[nodeId] || [])
          : [...(incomingById[nodeId] || []), ...(outgoingById[nodeId] || [])];
      const values = linked
        .filter((neighborId) => {
          const neighborColumn = columnByNodeId[neighborId];
          if (!Number.isFinite(neighborColumn)) {
            return false;
          }
          if (direction === "incoming") {
            return neighborColumn <= currentColumn;
          }
          if (direction === "outgoing") {
            return neighborColumn >= currentColumn;
          }
          return true;
        })
        .map((neighborId) => rowIndexById[neighborId])
        .filter(Number.isFinite);
      if (!values.length) {
        return Number.NaN;
      }
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    }
    refreshRowIndex();
    if (columnCount > 1) {
      for (let pass = 0; pass < 3; pass += 1) {
        for (let i = 1; i < columnCount; i += 1) {
          columns[i].sort((a, b) => {
            const aBary = barycenter(a.id, "incoming");
            const bBary = barycenter(b.id, "incoming");
            const aHasBary = Number.isFinite(aBary);
            const bHasBary = Number.isFinite(bBary);
            if (aHasBary && bHasBary && Math.abs(aBary - bBary) > 0.001) {
              return aBary - bBary;
            }
            if (aHasBary !== bHasBary) {
              return aHasBary ? -1 : 1;
            }
            const degreeGap = (degreeById[b.id] || 0) - (degreeById[a.id] || 0);
            if (degreeGap !== 0) {
              return degreeGap;
            }
            return a.name.localeCompare(b.name);
          });
          refreshRowIndex();
        }
        for (let i = columnCount - 2; i >= 0; i -= 1) {
          columns[i].sort((a, b) => {
            const aBary = barycenter(a.id, "outgoing");
            const bBary = barycenter(b.id, "outgoing");
            const aHasBary = Number.isFinite(aBary);
            const bHasBary = Number.isFinite(bBary);
            if (aHasBary && bHasBary && Math.abs(aBary - bBary) > 0.001) {
              return aBary - bBary;
            }
            if (aHasBary !== bHasBary) {
              return aHasBary ? -1 : 1;
            }
            const degreeGap = (degreeById[b.id] || 0) - (degreeById[a.id] || 0);
            if (degreeGap !== 0) {
              return degreeGap;
            }
            return a.name.localeCompare(b.name);
          });
          refreshRowIndex();
        }
      }
    }
    let laneBottom = top + laneHeader + lanePadding;
    const columnContentHeights = columns.map((columnNodes) => {
      if (!columnNodes.length) {
        return 0;
      }
      const nodesHeight = columnNodes.reduce((sum, node) => sum + visualById[node.id].height, 0);
      const gapsHeight = Math.max(0, columnNodes.length - 1) * 34;
      return nodesHeight + gapsHeight;
    });
    const maxColumnContentHeight = Math.max(0, ...columnContentHeights);
    for (let i = 0; i < columnCount; i += 1) {
      const columnNodes = columns[i];
      const verticalOffset = (maxColumnContentHeight - (columnContentHeights[i] || 0)) / 2;
      let cursorY = top + laneHeader + lanePadding + verticalOffset;
      const columnX = laneX + lanePadding + i * (maxNodeWidth + columnGap);
      for (const node of columnNodes) {
        const visual = visualById[node.id];
        const nodeX = columnX + (maxNodeWidth - visual.width) / 2;
        drawNodes.push({
          ...node,
          ...visual,
          x: nodeX,
          y: cursorY,
          portStartY: cursorY + visual.portStartOffset,
        });
        cursorY += visual.height + 34;
      }
      laneBottom = Math.max(laneBottom, cursorY);
    }
    const laneHeight = Math.max(430, laneBottom - top + lanePadding);
    lanes.push({
      layer,
      x: laneX,
      y: top,
      width: laneWidth,
      height: laneHeight,
    });
    maxHeight = Math.max(maxHeight, laneHeight + 110);
  }
  const width = Math.max(640, totalWidth - laneGap + 130);
  const containerDefs = buildExpandedContainerDefs(
    nodes,
    focusPathIds,
    moduleById,
    expandedModuleIds,
    selectedModuleId,
  );
  const nodeById = Object.fromEntries(drawNodes.map((item) => [item.id, item]));
  const moduleContainers = materializeExpandedContainers(containerDefs, nodeById, lanes);
  const sized = boundsWithPadding(
    { width, height: maxHeight },
    drawNodes,
    lanes,
    moduleContainers,
  );
  return {
    width: sized.width,
    height: sized.height,
    lanes,
    containerDefs,
    moduleContainers,
    nodes: drawNodes,
  };
}
export function snapToGrid(value, grid = 12) {
  return Math.round(value / grid) * grid;
}
export function applyManualLayout(layout, manualPositions) {
  if (!layout || !manualPositions || !Object.keys(manualPositions).length) {
    return layout;
  }
  const nodes = layout.nodes.map((node) => {
    const manual = manualPositions[node.id];
    if (!manual) {
      return node;
    }
    return {
      ...node,
      x: manual.x,
      y: manual.y,
    };
  });
  const groupedByLayer = {};
  for (const node of nodes) {
    if (!groupedByLayer[node.layer]) {
      groupedByLayer[node.layer] = [];
    }
    groupedByLayer[node.layer].push(node);
  }
  const lanes = layout.lanes.map((lane) => {
    const members = groupedByLayer[lane.layer] || [];
    if (!members.length) {
      return lane;
    }
    const minX = Math.min(...members.map((node) => node.x)) - 30;
    const maxX = Math.max(...members.map((node) => node.x + node.width)) + 30;
    const minY = Math.min(...members.map((node) => node.y)) - 50;
    const maxY = Math.max(...members.map((node) => node.y + node.height)) + 26;
    return {
      ...lane,
      x: Math.min(lane.x, minX),
      y: Math.min(lane.y, minY),
      width: Math.max(lane.width, maxX - Math.min(lane.x, minX)),
      height: Math.max(lane.height, maxY - Math.min(lane.y, minY)),
    };
  });
  const nodeById = Object.fromEntries(nodes.map((item) => [item.id, item]));
  const moduleContainers = materializeExpandedContainers(layout.containerDefs || [], nodeById, lanes);
  const sized = boundsWithPadding(layout, nodes, lanes, moduleContainers);
  return {
    ...layout,
    nodes,
    lanes,
    moduleContainers,
    width: sized.width,
    height: sized.height,
  };
}
export function clampZoom(value) {
  return Math.min(2.8, Math.max(0.35, value));
}
export function distributeOnSpan(min, max, index, count) {
  if (count <= 1) {
    return (min + max) / 2;
  }
  const span = Math.max(10, max - min);
  const step = span / (count + 1);
  return min + step * (index + 1);
}
export function stableHash(text) {
  let hash = 17;
  for (const ch of Array.from(String(text || ""))) {
    hash = (hash * 31 + (ch.codePointAt(0) || 0)) % 9973;
  }
  return hash;
}
export function buildEdgeGeometries(edges, nodeById) {
  if (!edges.length) {
    return {};
  }
  const records = edges
    .map((edge) => {
      const source = nodeById[edge.src_id];
      const target = nodeById[edge.dst_id];
      if (!source || !target) {
        return null;
      }
      const leftToRight = source.x + source.width / 2 <= target.x + target.width / 2;
      return {
        edge,
        source,
        target,
        leftToRight,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const keyA = `${a.edge.src_id}|${a.edge.dst_id}|${a.edge.kind}|${a.edge.id}`;
      const keyB = `${b.edge.src_id}|${b.edge.dst_id}|${b.edge.kind}|${b.edge.id}`;
      return keyA.localeCompare(keyB);
    });
  const recordByEdgeId = Object.fromEntries(records.map((item) => [item.edge.id, item]));
  const outgoing = new Map();
  const incoming = new Map();
  for (const item of records) {
    const sourceSide = item.leftToRight ? "right" : "left";
    const targetSide = item.leftToRight ? "left" : "right";
    const outKey = `${item.edge.src_id}|${sourceSide}`;
    const inKey = `${item.edge.dst_id}|${targetSide}`;
    if (!outgoing.has(outKey)) {
      outgoing.set(outKey, []);
    }
    if (!incoming.has(inKey)) {
      incoming.set(inKey, []);
    }
    outgoing.get(outKey).push(item.edge.id);
    incoming.get(inKey).push(item.edge.id);
  }
  const stableSortKey = (edgeId) => {
    const edge = recordByEdgeId[edgeId]?.edge;
    return `${edge?.src_id || ""}|${edge?.dst_id || ""}|${edge?.kind || ""}|${edge?.id || ""}`;
  };
  const sortOutgoingByTargetPosition = (edgeIdA, edgeIdB) => {
    const recordA = recordByEdgeId[edgeIdA];
    const recordB = recordByEdgeId[edgeIdB];
    if (!recordA || !recordB) {
      return stableSortKey(edgeIdA).localeCompare(stableSortKey(edgeIdB));
    }
    const targetCenterYGap = (recordA.target.y + recordA.target.height / 2) - (recordB.target.y + recordB.target.height / 2);
    if (Math.abs(targetCenterYGap) > 0.8) {
      return targetCenterYGap;
    }
    const targetCenterXGap = (recordA.target.x + recordA.target.width / 2) - (recordB.target.x + recordB.target.width / 2);
    if (Math.abs(targetCenterXGap) > 0.8) {
      return targetCenterXGap;
    }
    return stableSortKey(edgeIdA).localeCompare(stableSortKey(edgeIdB));
  };
  const sortIncomingBySourcePosition = (edgeIdA, edgeIdB) => {
    const recordA = recordByEdgeId[edgeIdA];
    const recordB = recordByEdgeId[edgeIdB];
    if (!recordA || !recordB) {
      return stableSortKey(edgeIdA).localeCompare(stableSortKey(edgeIdB));
    }
    const sourceCenterYGap = (recordA.source.y + recordA.source.height / 2) - (recordB.source.y + recordB.source.height / 2);
    if (Math.abs(sourceCenterYGap) > 0.8) {
      return sourceCenterYGap;
    }
    const sourceCenterXGap = (recordA.source.x + recordA.source.width / 2) - (recordB.source.x + recordB.source.width / 2);
    if (Math.abs(sourceCenterXGap) > 0.8) {
      return sourceCenterXGap;
    }
    return stableSortKey(edgeIdA).localeCompare(stableSortKey(edgeIdB));
  };
  const outgoingByEdgeId = {};
  const incomingByEdgeId = {};
  for (const edgeIds of outgoing.values()) {
    edgeIds.sort(sortOutgoingByTargetPosition);
    edgeIds.forEach((edgeId, index) => {
      outgoingByEdgeId[edgeId] = { index, count: edgeIds.length };
    });
  }
  for (const edgeIds of incoming.values()) {
    edgeIds.sort(sortIncomingBySourcePosition);
    edgeIds.forEach((edgeId, index) => {
      incomingByEdgeId[edgeId] = { index, count: edgeIds.length };
    });
  }
  const pairGroups = new Map();
  for (const item of records) {
    const pairKey = `${item.edge.src_id}|${item.edge.dst_id}|${item.edge.kind}`;
    if (!pairGroups.has(pairKey)) {
      pairGroups.set(pairKey, []);
    }
    pairGroups.get(pairKey).push(item.edge.id);
  }
  const pairMetaByEdgeId = {};
  for (const edgeIds of pairGroups.values()) {
    edgeIds.sort((a, b) => String(a).localeCompare(String(b)));
    edgeIds.forEach((edgeId, index) => {
      pairMetaByEdgeId[edgeId] = { index, count: edgeIds.length };
    });
  }
  const output = {};
  records.forEach((item) => {
    const edgeId = item.edge.id;
    const outMeta = outgoingByEdgeId[edgeId] || { index: 0, count: 1 };
    const inMeta = incomingByEdgeId[edgeId] || { index: 0, count: 1 };
    const pairMeta = pairMetaByEdgeId[edgeId] || { index: 0, count: 1 };
    const sourceSide = item.leftToRight ? "right" : "left";
    const targetSide = item.leftToRight ? "left" : "right";
    const startX = sourceSide === "right" ? item.source.x + item.source.width : item.source.x;
    const endX = targetSide === "left" ? item.target.x : item.target.x + item.target.width;
    const startY = distributeOnSpan(
      item.source.y + 24,
      item.source.y + item.source.height - 18,
      outMeta.index,
      outMeta.count,
    );
    const endY = distributeOnSpan(
      item.target.y + 24,
      item.target.y + item.target.height - 18,
      inMeta.index,
      inMeta.count,
    );
    const direction = item.leftToRight ? 1 : -1;
    let sourceGateX = startX + direction * (24 + outMeta.index * 8);
    let targetGateX = endX - direction * (24 + inMeta.index * 8);
    const minGateGap = 24;
    if (item.leftToRight && sourceGateX >= targetGateX - minGateGap) {
      const center = (startX + endX) / 2;
      sourceGateX = center - minGateGap / 2;
      targetGateX = center + minGateGap / 2;
    } else if (!item.leftToRight && sourceGateX <= targetGateX + minGateGap) {
      const center = (startX + endX) / 2;
      sourceGateX = center + minGateGap / 2;
      targetGateX = center - minGateGap / 2;
    }
    const pairCenterOffset = (pairMeta.index - (pairMeta.count - 1) / 2) * 12;
    const kindOffset = item.edge.kind === "interface" ? -4 : item.edge.kind === "dependency_file" ? 4 : 0;
    const hashOffset = (stableHash(`${item.edge.src_id}|${item.edge.dst_id}|${item.edge.kind}`) % 7 - 3) * 2.5;
    let bridgeX = (sourceGateX + targetGateX) / 2 + pairCenterOffset + kindOffset + hashOffset;
    if (item.leftToRight) {
      bridgeX = Math.max(sourceGateX + 10, Math.min(targetGateX - 10, bridgeX));
    } else {
      bridgeX = Math.min(sourceGateX - 10, Math.max(targetGateX + 10, bridgeX));
    }
    const labelX = bridgeX + (item.leftToRight ? 6 : -6);
    const labelY = (startY + endY) / 2 - 4;
    output[edgeId] = {
      path: [
        `M ${startX} ${startY}`,
        `L ${sourceGateX} ${startY}`,
        `L ${bridgeX} ${startY}`,
        `L ${bridgeX} ${endY}`,
        `L ${targetGateX} ${endY}`,
        `L ${endX} ${endY}`,
      ].join(" "),
      startX,
      startY,
      endX,
      endY,
      labelX,
      labelY,
      sourceSide,
      targetSide,
      leftToRight: item.leftToRight,
    };
  });
  return output;
}
export function summarizeModel(model, snapshot) {
  if (!model) {
    return {
      modules: 0,
      ports: 0,
      edges: 0,
      evidences: 0,
      analyzedFiles: 0,
      eligibleFiles: 0,
      coveragePct: 0,
    };
  }
  const coverage = snapshot?.metadata?.coverage || {};
  const analyzedFiles = Number(coverage.analyzed_files || 0);
  const eligibleFiles = Number(coverage.eligible_files || 0);
  const coverageRatio = Number(coverage.coverage_ratio || 0);
  return {
    modules: (model.modules || []).length,
    ports: (model.ports || []).length,
    edges: (model.edges || []).length,
    evidences: (snapshot?.evidences || []).length,
    analyzedFiles,
    eligibleFiles,
    coveragePct: Math.round(coverageRatio * 10000) / 100,
  };
}
