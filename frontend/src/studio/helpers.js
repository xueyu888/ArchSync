import {
  buildExpandedContainerDefs,
  materializeExpandedContainers,
} from "./container-layout.js";

export { buildExpandedContainerDefs, materializeExpandedContainers };

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
    // Treat the auto-computed box as the minimum safe size; manual resizing can expand/shrink
    // but never below this, keeping ports/text inside the frame.
    minWidth: width,
    minHeight: height,
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
  const isLayerRootId = (moduleId) => String(moduleId || "").startsWith("layer:");
  const expandedSet = ensureSet(expandedModuleIds);
  const focusPath = lineage(focusModuleId, moduleById);
  const focusPathIds = focusPath.map((item) => item.id);
  const focusPathIdSet = new Set(focusPathIds);
  const rootId = focusPath[0]?.id || focusModuleId;
  let visibleIds = new Set();
  for (const child of childrenByParent[focusModuleId] || []) {
    // Layer root nodes are represented by lanes; treat them as transparent groups in the semantic view.
    if (isLayerRootId(child.id)) {
      for (const grandChild of childrenByParent[child.id] || []) {
        visibleIds.add(grandChild.id);
      }
      continue;
    }
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

function normalizeToPositive(nodes, lanes, moduleContainers, minCoord = 8) {
  const candidates = [
    ...nodes.map((item) => ({ x: item.x, y: item.y })),
    ...lanes.map((item) => ({ x: item.x, y: item.y })),
    ...(moduleContainers || []).map((item) => ({ x: item.x, y: item.y })),
  ];
  if (!candidates.length) {
    return { nodes, lanes, moduleContainers, dx: 0, dy: 0 };
  }
  const minX = Math.min(...candidates.map((item) => item.x));
  const minY = Math.min(...candidates.map((item) => item.y));
  const dx = minX < minCoord ? minCoord - minX : 0;
  const dy = minY < minCoord ? minCoord - minY : 0;
  if (!dx && !dy) {
    return { nodes, lanes, moduleContainers, dx, dy };
  }
  const shift = (item) => ({ ...item, x: item.x + dx, y: item.y + dy });
  const shiftNode = (node) => ({
    ...node,
    x: node.x + dx,
    y: node.y + dy,
    portStartY: Number.isFinite(node.portStartY) ? node.portStartY + dy : node.portStartY,
  });
  return {
    nodes: nodes.map(shiftNode),
    lanes: lanes.map(shift),
    moduleContainers: (moduleContainers || []).map(shift),
    dx,
    dy,
  };
}

function expandLanesToContain(lanes, moduleContainers) {
  if (!lanes?.length || !moduleContainers?.length) {
    return lanes || [];
  }
  const containersByLayer = {};
  for (const container of moduleContainers) {
    if (!container?.layer) continue;
    if (!containersByLayer[container.layer]) containersByLayer[container.layer] = [];
    containersByLayer[container.layer].push(container);
  }
  const pad = 16;
  return (lanes || []).map((lane) => {
    const containers = containersByLayer[lane.layer] || [];
    if (!containers.length) {
      return lane;
    }
    const minX = Math.min(lane.x, ...containers.map((c) => c.x - pad));
    const minY = Math.min(lane.y, ...containers.map((c) => c.y - pad));
    const maxX = Math.max(lane.x + lane.width, ...containers.map((c) => c.x + c.width + pad));
    const maxY = Math.max(lane.y + lane.height, ...containers.map((c) => c.y + c.height + pad));
    return {
      ...lane,
      x: Math.max(8, minX),
      y: Math.max(8, minY),
      width: Math.max(lane.width, maxX - Math.max(8, minX)),
      height: Math.max(lane.height, maxY - Math.max(8, minY)),
    };
  });
}

function enforceContainmentByLineage(nodes, moduleContainers, containerDefs = [], minCoord = 8) {
  if (!nodes?.length || !moduleContainers?.length) {
    return moduleContainers || [];
  }
  const boxesById = Object.fromEntries((moduleContainers || []).map((box) => [box.id, { ...box }]));
  const parentById = {};
  for (const node of nodes || []) {
    if (node?.id) {
      parentById[node.id] = node.parent_id || "";
    }
  }
  for (const def of containerDefs || []) {
    if (def?.id && def.parentId) {
      parentById[def.id] = def.parentId;
    }
  }
  const expandBox = (containerId, rect, margins) => {
    const box = boxesById[containerId];
    if (!box || !rect) {
      return;
    }
    const marginTop = Number(margins?.top ?? 0);
    const marginRight = Number(margins?.right ?? 0);
    const marginBottom = Number(margins?.bottom ?? 0);
    const marginLeft = Number(margins?.left ?? 0);
    const minX = Math.max(minCoord, Math.min(Number(box.x) || 0, rect.x - marginLeft));
    const minY = Math.max(minCoord, Math.min(Number(box.y) || 0, rect.y - marginTop));
    const maxX = Math.max((Number(box.x) || 0) + (Number(box.width) || 0), rect.x + rect.width + marginRight);
    const maxY = Math.max((Number(box.y) || 0) + (Number(box.height) || 0), rect.y + rect.height + marginBottom);
    const minWidth = Math.max(1, Number(box.minWidth) || 0);
    const minHeight = Math.max(1, Number(box.minHeight) || 0);
    box.x = minX;
    box.y = minY;
    box.width = Math.max(minWidth, maxX - minX);
    box.height = Math.max(minHeight, maxY - minY);
  };

  const nodeMargins = { top: 20, right: 14, bottom: 16, left: 14 };
  for (const node of nodes || []) {
    if (!node?.id) continue;
    const rect = {
      x: Number(node.x) || 0,
      y: Number(node.y) || 0,
      width: Math.max(1, Number(node.width) || 0),
      height: Math.max(1, Number(node.height) || 0),
    };
    let parentId = parentById[node.id] || "";
    let guard = 0;
    while (parentId && guard < 96) {
      expandBox(parentId, rect, nodeMargins);
      parentId = parentById[parentId] || "";
      guard += 1;
    }
  }

  const childMargins = { top: 24, right: 18, bottom: 18, left: 18 };
  const descFirst = Object.values(boxesById).sort((a, b) => (Number(b.level) || 0) - (Number(a.level) || 0));
  for (const child of descFirst) {
    if (!child?.id) continue;
    const rect = {
      x: Number(child.x) || 0,
      y: Number(child.y) || 0,
      width: Math.max(1, Number(child.width) || 0),
      height: Math.max(1, Number(child.height) || 0),
    };
    let parentId = parentById[child.id] || "";
    let guard = 0;
    while (parentId && guard < 96) {
      expandBox(parentId, rect, childMargins);
      parentId = parentById[parentId] || "";
      guard += 1;
    }
  }

  return (moduleContainers || []).map((box) => boxesById[box.id] || box)
    .sort((a, b) => (a.level || 0) - (b.level || 0) || (b.width * b.height) - (a.width * a.height));
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
  const top = 84;
  const left = 76;
  const nodeModels = nodes || [];
  const { degree: degreeById } = computeLayerGraphHints(nodeModels, edges);
  const visualById = {};
  for (const node of nodeModels) {
    const ports = portsByModule[node.id] || [];
    const summary = (summaryByModule[node.id] || "").trim();
    const source = summary ? (summarySourceByModule[node.id] || "fallback") : "";
    visualById[node.id] = buildNodeVisual(node, ports, summary, source);
  }

  const layerOrder = Array.from(new Set(nodeModels.map((node) => node.layer).filter(Boolean)));
  const layerIndexByName = Object.fromEntries(layerOrder.map((layer, index) => [layer, index]));
  function layerIndexOf(layerName) {
    if (layerIndexByName[layerName] !== undefined) {
      return layerIndexByName[layerName];
    }
    const nextIndex = layerOrder.length;
    layerOrder.push(layerName || "Unknown");
    layerIndexByName[layerName] = nextIndex;
    return nextIndex;
  }
  function nodeSortRank(nodeId) {
    return Number(degreeById[nodeId] || 0);
  }
  function itemSortKey(item) {
    return `${item.layerIndex}|${item.kind === "container" ? 0 : 1}|${item.sortName || item.id}`;
  }
  function itemKey(item) {
    return `${item.kind}:${item.id}`;
  }
  function packBalancedColumns(items, options = {}) {
    const gapX = Number(options.gapX || 34);
    const gapY = Number(options.gapY || 26);
    const maxColumns = Math.max(1, Number(options.maxColumns || 3));
    const targetAspect = Number(options.targetAspect || 1.25);
    if (!items.length) {
      return { width: 0, height: 0, placements: {} };
    }

    const sortedItems = [...items].sort((a, b) => {
      const layerGap = (a.layerIndex || 0) - (b.layerIndex || 0);
      if (layerGap !== 0) return layerGap;
      const kindGap = (a.kind === "container" ? 0 : 1) - (b.kind === "container" ? 0 : 1);
      if (kindGap !== 0) return kindGap;
      const degreeGap = (b.sortRank || 0) - (a.sortRank || 0);
      if (degreeGap !== 0) return degreeGap;
      return (a.sortName || a.id).localeCompare(b.sortName || b.id);
    });

    let best = null;
    const columnCap = Math.min(maxColumns, sortedItems.length);
    for (let columnCount = 1; columnCount <= columnCap; columnCount += 1) {
      const columns = Array.from({ length: columnCount }, () => []);
      const columnHeights = Array.from({ length: columnCount }, () => 0);

      for (const item of sortedItems) {
        let bestColumn = 0;
        for (let i = 1; i < columnCount; i += 1) {
          if (columnHeights[i] < columnHeights[bestColumn]) {
            bestColumn = i;
          }
        }
        const addHeight = columns[bestColumn].length ? item.height + gapY : item.height;
        columns[bestColumn].push(item);
        columnHeights[bestColumn] += addHeight;
      }

      const columnWidths = columns.map((column) => (
        column.length ? Math.max(...column.map((item) => item.width)) : 0
      ));
      const width = columnWidths.reduce((sum, value) => sum + value, 0) + gapX * Math.max(0, columnCount - 1);
      const height = Math.max(0, ...columnHeights);
      const aspect = width / Math.max(1, height);
      const areaPenalty = (width * height) / 1_000_000;
      const score = Math.abs(aspect - targetAspect) * 2.3 + areaPenalty + columnCount * 0.15;

      const placements = {};
      let cursorX = 0;
      columns.forEach((column, columnIndex) => {
        let cursorY = 0;
        column.forEach((item) => {
          placements[itemKey(item)] = { x: cursorX, y: cursorY };
          cursorY += item.height + gapY;
        });
        cursorX += columnWidths[columnIndex] + gapX;
      });

      if (!best || score < best.score) {
        best = { score, width, height, placements };
      }
    }

    return best || { width: 0, height: 0, placements: {} };
  }
  function packItemsByLayer(items, options = {}) {
    const layerGapX = Number(options.layerGapX || 56);
    const itemGapX = Number(options.itemGapX || 34);
    const itemGapY = Number(options.itemGapY || 26);
    const maxColumnsPerLayer = Math.max(1, Number(options.maxColumnsPerLayer || 3));
    const targetAspect = Number(options.targetAspect || 1.2);
    if (!items.length) {
      return { width: 0, height: 0, placements: {} };
    }
    const grouped = new Map();
    for (const item of items) {
      const key = Number.isFinite(item.layerIndex) ? item.layerIndex : 0;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(item);
    }
    const layerKeys = Array.from(grouped.keys()).sort((a, b) => a - b);
    const layerLayouts = [];
    for (const layerKey of layerKeys) {
      const layerItems = [...grouped.get(layerKey)];
      layerItems.sort((a, b) => itemSortKey(a).localeCompare(itemSortKey(b)));
      const packed = packBalancedColumns(layerItems, {
        gapX: itemGapX,
        gapY: itemGapY,
        maxColumns: maxColumnsPerLayer,
        targetAspect,
      });
      layerLayouts.push({ layerKey, packed, items: layerItems });
    }
    const contentHeight = Math.max(0, ...layerLayouts.map((entry) => entry.packed.height));
    let contentWidth = 0;
    for (let i = 0; i < layerLayouts.length; i += 1) {
      contentWidth += layerLayouts[i].packed.width;
      if (i < layerLayouts.length - 1) {
        contentWidth += layerGapX;
      }
    }

    const placements = {};
    let cursorX = 0;
    for (const entry of layerLayouts) {
      const layerOffsetY = (contentHeight - entry.packed.height) / 2;
      for (const item of entry.items) {
        const point = entry.packed.placements[itemKey(item)] || { x: 0, y: 0 };
        placements[itemKey(item)] = {
          x: cursorX + point.x,
          y: layerOffsetY + point.y,
        };
      }
      cursorX += entry.packed.width + layerGapX;
    }

    return {
      width: Math.max(0, contentWidth),
      height: Math.max(0, contentHeight),
      placements,
    };
  }

  const containerDefs = buildExpandedContainerDefs(
    nodeModels,
    focusPathIds,
    moduleById,
    expandedModuleIds,
    selectedModuleId,
  );

  const defById = Object.fromEntries(containerDefs.map((def) => [def.id, def]));
  const childContainerIdsByParent = {};
  for (const def of containerDefs) {
    if (!def.parentId || !defById[def.parentId]) {
      continue;
    }
    if (!childContainerIdsByParent[def.parentId]) {
      childContainerIdsByParent[def.parentId] = [];
    }
    childContainerIdsByParent[def.parentId].push(def.id);
  }
  for (const parentId of Object.keys(childContainerIdsByParent)) {
    childContainerIdsByParent[parentId].sort((leftId, rightId) => {
      const leftDef = defById[leftId];
      const rightDef = defById[rightId];
      const leftLayer = layerIndexOf(leftDef?.layer);
      const rightLayer = layerIndexOf(rightDef?.layer);
      if (leftLayer !== rightLayer) return leftLayer - rightLayer;
      if ((leftDef?.level || 0) !== (rightDef?.level || 0)) return (leftDef?.level || 0) - (rightDef?.level || 0);
      return (leftDef?.name || leftId).localeCompare(rightDef?.name || rightId);
    });
  }

  const ownerByNodeId = {};
  const directNodeIdsByContainer = {};
  const defsByDepth = [...containerDefs].sort((a, b) => (b.level || 0) - (a.level || 0));
  for (const def of defsByDepth) {
    for (const nodeId of def.memberIds || []) {
      if (ownerByNodeId[nodeId]) {
        continue;
      }
      ownerByNodeId[nodeId] = def.id;
      if (!directNodeIdsByContainer[def.id]) {
        directNodeIdsByContainer[def.id] = [];
      }
      directNodeIdsByContainer[def.id].push(nodeId);
    }
  }
  for (const containerId of Object.keys(directNodeIdsByContainer)) {
    directNodeIdsByContainer[containerId].sort((leftId, rightId) => {
      const leftNode = moduleById[leftId];
      const rightNode = moduleById[rightId];
      const layerGap = layerIndexOf(leftNode?.layer) - layerIndexOf(rightNode?.layer);
      if (layerGap !== 0) return layerGap;
      const degreeGap = nodeSortRank(rightId) - nodeSortRank(leftId);
      if (degreeGap !== 0) return degreeGap;
      return (leftNode?.name || leftId).localeCompare(rightNode?.name || rightId);
    });
  }

  const containerLayoutById = {};
  function measureContainer(containerId) {
    if (containerLayoutById[containerId]) {
      return containerLayoutById[containerId];
    }

    const def = defById[containerId];
    const childContainerIds = childContainerIdsByParent[containerId] || [];
    const directNodeIds = (directNodeIdsByContainer[containerId] || [])
      .filter((nodeId) => !!moduleById[nodeId] && !!visualById[nodeId]);

    const childItems = [];
    for (const childId of childContainerIds) {
      const childLayout = measureContainer(childId);
      childItems.push({
        kind: "container",
        id: childId,
        width: childLayout.width,
        height: childLayout.height,
        layerIndex: childLayout.layerIndex,
        sortName: defById[childId]?.name || childId,
        sortRank: 0,
      });
    }
    for (const nodeId of directNodeIds) {
      const node = moduleById[nodeId];
      const visual = visualById[nodeId];
      childItems.push({
        kind: "node",
        id: nodeId,
        width: visual.width,
        height: visual.height,
        layerIndex: layerIndexOf(node.layer),
        sortName: node.name || nodeId,
        sortRank: nodeSortRank(nodeId),
      });
    }

    const content = packItemsByLayer(childItems, {
      layerGapX: 52,
      itemGapX: 30,
      itemGapY: 26,
      maxColumnsPerLayer: 3,
      targetAspect: 1.25,
    });
    const padding = { top: 30, right: 24, bottom: 24, left: 28 };
    const width = Math.max(220, content.width + padding.left + padding.right);
    const height = Math.max(160, content.height + padding.top + padding.bottom);
    const layerIndex = childItems.length
      ? Math.min(...childItems.map((item) => item.layerIndex))
      : layerIndexOf(def?.layer);

    const placements = {};
    for (const item of childItems) {
      const point = content.placements[itemKey(item)] || { x: 0, y: 0 };
      placements[itemKey(item)] = {
        x: padding.left + point.x,
        y: padding.top + point.y,
      };
    }

    const layout = {
      id: containerId,
      kind: "container",
      width,
      height,
      layerIndex,
      children: childItems,
      placements,
    };
    containerLayoutById[containerId] = layout;
    return layout;
  }

  const rootContainerIds = containerDefs
    .filter((def) => !def.parentId || !defById[def.parentId])
    .map((def) => def.id)
    .sort((leftId, rightId) => {
      const leftDef = defById[leftId];
      const rightDef = defById[rightId];
      const layerGap = layerIndexOf(leftDef?.layer) - layerIndexOf(rightDef?.layer);
      if (layerGap !== 0) return layerGap;
      if ((leftDef?.level || 0) !== (rightDef?.level || 0)) return (leftDef?.level || 0) - (rightDef?.level || 0);
      return (leftDef?.name || leftId).localeCompare(rightDef?.name || rightId);
    });
  const nodeIds = nodeModels.map((node) => node.id);
  const looseNodeIds = nodeIds.filter((nodeId) => !ownerByNodeId[nodeId] && visualById[nodeId]);
  looseNodeIds.sort((leftId, rightId) => {
    const leftNode = moduleById[leftId];
    const rightNode = moduleById[rightId];
    const layerGap = layerIndexOf(leftNode?.layer) - layerIndexOf(rightNode?.layer);
    if (layerGap !== 0) return layerGap;
    const degreeGap = nodeSortRank(rightId) - nodeSortRank(leftId);
    if (degreeGap !== 0) return degreeGap;
    return (leftNode?.name || leftId).localeCompare(rightNode?.name || rightId);
  });

  const rootItems = [];
  for (const containerId of rootContainerIds) {
    const measured = measureContainer(containerId);
    rootItems.push({
      kind: "container",
      id: containerId,
      width: measured.width,
      height: measured.height,
      layerIndex: measured.layerIndex,
      sortName: defById[containerId]?.name || containerId,
      sortRank: 0,
    });
  }
  for (const nodeId of looseNodeIds) {
    const node = moduleById[nodeId];
    const visual = visualById[nodeId];
    rootItems.push({
      kind: "node",
      id: nodeId,
      width: visual.width,
      height: visual.height,
      layerIndex: layerIndexOf(node?.layer),
      sortName: node?.name || nodeId,
      sortRank: nodeSortRank(nodeId),
    });
  }
  rootItems.sort((a, b) => itemSortKey(a).localeCompare(itemSortKey(b)));
  const rootPacked = packItemsByLayer(rootItems, {
    layerGapX: 108,
    itemGapX: 48,
    itemGapY: 48,
    maxColumnsPerLayer: 4,
    targetAspect: 1.45,
  });

  const drawNodes = [];
  const moduleContainers = [];
  function placeItem(item, originX, originY) {
    if (item.kind === "node") {
      const node = moduleById[item.id];
      const visual = visualById[item.id];
      if (!node || !visual) {
        return;
      }
      drawNodes.push({
        ...node,
        ...visual,
        x: originX,
        y: originY,
        portStartY: originY + visual.portStartOffset,
      });
      return;
    }

    const def = defById[item.id];
    const measured = containerLayoutById[item.id];
    if (!def || !measured) {
      return;
    }
    moduleContainers.push({
      id: def.id,
      name: def.name,
      layer: def.layer,
      level: def.level,
      parentId: def.parentId || "",
      x: originX,
      y: originY,
      width: measured.width,
      height: measured.height,
      memberCount: (directNodeIdsByContainer[item.id] || []).length,
    });
    for (const child of measured.children) {
      const offset = measured.placements[itemKey(child)] || { x: 0, y: 0 };
      placeItem(child, originX + offset.x, originY + offset.y);
    }
  }
  for (const item of rootItems) {
    const offset = rootPacked.placements[itemKey(item)] || { x: 0, y: 0 };
    placeItem(item, left + offset.x, top + offset.y);
  }

  const lanes = [];
  for (const layer of layerOrder) {
    const members = drawNodes.filter((node) => node.layer === layer);
    if (!members.length) {
      continue;
    }
    const minX = Math.min(...members.map((node) => node.x)) - 34;
    const maxX = Math.max(...members.map((node) => node.x + node.width)) + 34;
    const minY = Math.min(...members.map((node) => node.y)) - 54;
    const maxY = Math.max(...members.map((node) => node.y + node.height)) + 28;
    lanes.push({
      layer,
      x: Math.max(8, minX),
      y: Math.max(8, minY),
      width: Math.max(380, maxX - Math.max(8, minX)),
      height: Math.max(430, maxY - Math.max(8, minY)),
    });
  }

  const layoutWidthHint = Math.max(640, left + rootPacked.width + 180);
  const layoutHeightHint = Math.max(500, top + rootPacked.height + 140);
  const normalized = normalizeToPositive(drawNodes, lanes, moduleContainers, 8);
  const constrainedContainers = enforceContainmentByLineage(
    normalized.nodes,
    normalized.moduleContainers,
    containerDefs,
    8,
  );
  const constrainedLanes = expandLanesToContain(normalized.lanes, constrainedContainers);
  const sized = boundsWithPadding(
    { width: layoutWidthHint, height: layoutHeightHint },
    normalized.nodes,
    constrainedLanes,
    constrainedContainers,
  );
  return {
    width: sized.width,
    height: sized.height,
    lanes: constrainedLanes,
    containerDefs,
    moduleContainers: constrainedContainers,
    nodes: normalized.nodes,
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
    const manualX = Number(manual.x);
    const manualY = Number(manual.y);
    const manualWidth = Number(manual.width);
    const manualHeight = Number(manual.height);
    const minWidth = Number(node.minWidth || node.width) || 0;
    const minHeight = Number(node.minHeight || node.height) || 0;
    const nextX = Number.isFinite(manualX) ? Math.max(12, manualX) : node.x;
    const nextY = Number.isFinite(manualY) ? Math.max(58, manualY) : node.y;
    const nextWidth = Number.isFinite(manualWidth) ? Math.max(minWidth, manualWidth) : node.width;
    const nextHeight = Number.isFinite(manualHeight) ? Math.max(minHeight, manualHeight) : node.height;
    return {
      ...node,
      x: nextX,
      y: nextY,
      width: nextWidth,
      height: nextHeight,
      portStartY: nextY + (Number(node.portStartOffset) || 0),
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
    const maxX = Math.max(...members.map((node) => node.x + node.width)) + 30;
    const maxY = Math.max(...members.map((node) => node.y + node.height)) + 26;
    return {
      ...lane,
      // Keep lane origins stable during manual edits. Expanding only width/height avoids
      // global "jumping" while dragging/resizing (Vivado-like direct manipulation).
      x: lane.x,
      y: lane.y,
      width: Math.max(lane.width, maxX - lane.x),
      height: Math.max(lane.height, maxY - lane.y),
    };
  });
  const nodeById = Object.fromEntries(nodes.map((item) => [item.id, item]));
  const moduleContainersRaw = materializeExpandedContainers(layout.containerDefs || [], nodeById, {
    sizeOverridesById: manualPositions,
  });
  const moduleContainers = enforceContainmentByLineage(nodes, moduleContainersRaw, layout.containerDefs || [], 8);
  const expandedLanes = expandLanesToContain(lanes, moduleContainers);
  const sized = boundsWithPadding(layout, nodes, expandedLanes, moduleContainers);
  return {
    ...layout,
    nodes,
    lanes: expandedLanes,
    moduleContainers,
    width: sized.width,
    height: sized.height,
  };
}
export function clampZoom(value) {
  return Math.min(2.8, Math.max(0.35, value));
}
export function frameToneByLevel(rawLevel) {
  const level = Math.max(0, Number(rawLevel) || 0);
  const ratio = Math.max(0, Math.min(1, level / 9));
  const eased = Math.pow(ratio, 0.9);
  const mix = (from, to) => from + (to - from) * ratio;
  const mixEased = (from, to) => from + (to - from) * eased;
  const hsl = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(l * 10) / 10}%)`;

  const stroke = hsl(mix(210, 214), 38, mixEased(60, 35));
  const strokeChain = hsl(mix(210, 214), 42, mixEased(56, 32));
  const strokeFocused = hsl(mix(208, 212), 54, mixEased(52, 29));
  const fill = hsl(mix(211, 214), 44, mixEased(96.5, 82));
  const fillFocused = hsl(mix(210, 214), 48, mixEased(94, 79));
  const chipFill = hsl(mix(210, 214), 50, mixEased(97, 85));
  const chipStroke = hsl(mix(210, 214), 40, mixEased(69, 45));
  const chipTitle = hsl(mix(212, 216), 44, mixEased(31, 22));
  const toggleFill = hsl(mix(210, 214), 52, mixEased(94.5, 81));
  const toggleStroke = hsl(mix(210, 214), 40, mixEased(60, 38));
  const nodeFrameStroke = hsl(mix(210, 214), 44, mixEased(56, 34));
  const nodeFrameFill = hsl(mix(210, 214), 50, mixEased(97, 84));
  const nodeBodyFill = hsl(mix(44, 42), 36, mixEased(92, 84));
  const nodeBodyFocusFill = hsl(mix(208, 212), 46, mixEased(95, 84));
  const nodeHeaderFill = hsl(mix(208, 213), 48, mixEased(85, 72));
  const nodeHeaderStroke = hsl(mix(209, 213), 38, mixEased(68, 46));

  return {
    stroke,
    strokeChain,
    strokeFocused,
    fill,
    fillFocused,
    chipFill,
    chipStroke,
    chipTitle,
    toggleFill,
    toggleStroke,
    nodeFrameStroke,
    nodeFrameFill,
    nodeBodyFill,
    nodeBodyFocusFill,
    nodeHeaderFill,
    nodeHeaderStroke,
  };
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
export function buildEdgeGeometries(edges, nodeById, options = {}) {
  if (!edges.length) {
    return {};
  }
  const {
    ownerContainerByNodeId = null,
    containerById = null,
    descendantsByModule = null,
  } = options || {};

  const obstacleNodes = Object.values(nodeById || {});
  const obstacleRects = obstacleNodes
    .map((node) => {
      if (!node) return null;
      return {
        id: node.id,
        x: Number(node.x) || 0,
        y: Number(node.y) || 0,
        width: Number(node.width) || 0,
        height: Number(node.height) || 0,
      };
    })
    .filter((rect) => rect && rect.width > 0 && rect.height > 0);
  const boundsTop = Math.max(8, Math.min(...obstacleRects.map((rect) => rect.y)) - 90);
  const boundsBottom = Math.max(boundsTop + 120, Math.max(...obstacleRects.map((rect) => rect.y + rect.height)) + 90);

  const EPS = 0.12;
  const OBSTACLE_MARGIN = 10;
  const inflateRect = (rect, margin = OBSTACLE_MARGIN) => ({
    ...rect,
    x: rect.x - margin,
    y: rect.y - margin,
    width: rect.width + margin * 2,
    height: rect.height + margin * 2,
  });
  function horizontalHitsRect(x0, x1, y, rect) {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    if (!(y > rect.y + EPS && y < rect.y + rect.height - EPS)) {
      return false;
    }
    return maxX > rect.x + EPS && minX < rect.x + rect.width - EPS;
  }
  function verticalHitsRect(y0, y1, x, rect) {
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    if (!(x > rect.x + EPS && x < rect.x + rect.width - EPS)) {
      return false;
    }
    return maxY > rect.y + EPS && minY < rect.y + rect.height - EPS;
  }
  function countIntersections(points, sourceId, targetId) {
    if (!points || points.length < 2) return 0;
    let count = 0;
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      if (dx < EPS && dy < EPS) {
        continue;
      }
      const horizontal = dy < EPS;
      const vertical = dx < EPS;
      if (!horizontal && !vertical) {
        continue;
      }
      for (const rect0 of obstacleRects) {
        if (!rect0 || rect0.id === sourceId || rect0.id === targetId) {
          continue;
        }
        const rect = inflateRect(rect0);
        if (horizontal && horizontalHitsRect(a.x, b.x, a.y, rect)) {
          count += 1;
          break;
        }
        if (vertical && verticalHitsRect(a.y, b.y, a.x, rect)) {
          count += 1;
          break;
        }
      }
    }
    return count;
  }
  const pathLength = (points) => {
    if (!points || points.length < 2) return 0;
    let length = 0;
    for (let i = 0; i < points.length - 1; i += 1) {
      length += Math.abs(points[i + 1].x - points[i].x) + Math.abs(points[i + 1].y - points[i].y);
    }
    return length;
  };
  const turnsCount = (points) => Math.max(0, (points?.length || 0) - 2);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  function dedupePoints(points) {
    const out = [];
    for (const point of points || []) {
      const last = out[out.length - 1];
      if (last && Math.abs(last.x - point.x) < EPS && Math.abs(last.y - point.y) < EPS) {
        continue;
      }
      out.push(point);
    }
    return out;
  }
  function pointsToPath(points) {
    const clean = dedupePoints(points);
    if (clean.length < 2) return "";
    return clean
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
      .join(" ");
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
  const GATE_OUTSIDE_MARGIN = 18;
  const crossesContainerBorder = (containerId, otherNodeId) => {
    if (!containerId) return false;
    const descendants = descendantsByModule?.[containerId];
    // When in doubt, assume it crosses so we push the gate outside rather than
    // routing a line through a container border without a clear interface.
    if (!descendants || typeof descendants.has !== "function") return true;
    return !descendants.has(otherNodeId);
  };
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

    // When an edge crosses a container boundary, ensure the first routing "gate"
    // for that endpoint is outside the container. This makes the border crossing
    // happen near the internal module (startY/endY) and aligns with interface
    // markers rendered on the container border.
    if (ownerContainerByNodeId && containerById) {
      const srcOwner = ownerContainerByNodeId[item.edge.src_id] || "";
      if (srcOwner && crossesContainerBorder(srcOwner, item.edge.dst_id)) {
        const container = containerById[srcOwner];
        if (container) {
          const right = (Number(container.x) || 0) + (Number(container.width) || 0);
          const left = Number(container.x) || 0;
          sourceGateX = direction === 1
            ? Math.max(sourceGateX, right + GATE_OUTSIDE_MARGIN)
            : Math.min(sourceGateX, left - GATE_OUTSIDE_MARGIN);
        }
      }
      const dstOwner = ownerContainerByNodeId[item.edge.dst_id] || "";
      if (dstOwner && crossesContainerBorder(dstOwner, item.edge.src_id)) {
        const container = containerById[dstOwner];
        if (container) {
          const right = (Number(container.x) || 0) + (Number(container.width) || 0);
          const left = Number(container.x) || 0;
          // Note: enter destination from the opposite side of the travel direction.
          targetGateX = direction === 1
            ? Math.min(targetGateX, left - GATE_OUTSIDE_MARGIN)
            : Math.max(targetGateX, right + GATE_OUTSIDE_MARGIN);
        }
      }
    }

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
    const minY = Math.min(startY, endY);
    const maxY = Math.max(startY, endY);
    const blockedRanges = [];
    for (const obstacle of obstacleNodes) {
      if (!obstacle || obstacle.id === item.edge.src_id || obstacle.id === item.edge.dst_id) {
        continue;
      }
      const top = obstacle.y - 8;
      const bottom = obstacle.y + obstacle.height + 8;
      if (bottom < minY || top > maxY) {
        continue;
      }
      blockedRanges.push([obstacle.x - 16, obstacle.x + obstacle.width + 16]);
    }
    blockedRanges.sort((a, b) => a[0] - b[0]);
    const mergedRanges = [];
    for (const range of blockedRanges) {
      const last = mergedRanges[mergedRanges.length - 1];
      if (!last || range[0] > last[1] + 1) {
        mergedRanges.push([range[0], range[1]]);
      } else {
        last[1] = Math.max(last[1], range[1]);
      }
    }
    const minBridgeX = Math.min(sourceGateX, targetGateX) + 10;
    const maxBridgeX = Math.max(sourceGateX, targetGateX) - 10;
    const insideBlockedRange = (x) => mergedRanges.some(([left, right]) => x >= left && x <= right);
    if (insideBlockedRange(bridgeX)) {
      const candidates = [bridgeX];
      for (const [left, right] of mergedRanges) {
        candidates.push(left - 12, right + 12);
      }
      candidates.push(sourceGateX + (item.leftToRight ? 14 : -14));
      candidates.push(targetGateX + (item.leftToRight ? -14 : 14));
      let bestBridgeX = bridgeX;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const rawCandidate of candidates) {
        const candidate = Math.max(minBridgeX, Math.min(maxBridgeX, rawCandidate));
        const blockedPenalty = insideBlockedRange(candidate) ? 100000 : 0;
        const score = blockedPenalty + Math.abs(candidate - bridgeX);
        if (score < bestScore) {
          bestScore = score;
          bestBridgeX = candidate;
        }
      }
      bridgeX = bestBridgeX;
    }
    const basePoints = [
      { x: startX, y: startY },
      { x: sourceGateX, y: startY },
      { x: bridgeX, y: startY },
      { x: bridgeX, y: endY },
      { x: targetGateX, y: endY },
      { x: endX, y: endY },
    ];

    const candidates = [];
    candidates.push({
      kind: "bridge",
      points: basePoints,
      label: { x: bridgeX + (item.leftToRight ? 6 : -6), y: (startY + endY) / 2 - 4 },
    });

    const pairYOffset = (pairMeta.index - (pairMeta.count - 1) / 2) * 10;
    const corridorBase = (startY + endY) / 2 + pairYOffset + (item.edge.kind === "interface" ? -6 : item.edge.kind === "dependency_file" ? 6 : 0);
    const corridorSteps = [0, 26, -26, 52, -52, 78, -78, 104, -104];
    const extraY = [
      Math.min(startY, endY) - 64,
      Math.max(startY, endY) + 64,
    ];
    const corridorYs = Array.from(new Set([
      ...corridorSteps.map((step) => corridorBase + step),
      ...extraY,
    ].map((value) => clamp(value, boundsTop, boundsBottom))));

    for (const routeY of corridorYs) {
      const corridorPoints = [
        { x: startX, y: startY },
        { x: sourceGateX, y: startY },
        { x: sourceGateX, y: routeY },
        { x: targetGateX, y: routeY },
        { x: targetGateX, y: endY },
        { x: endX, y: endY },
      ];
      candidates.push({
        kind: "corridor",
        points: corridorPoints,
        label: { x: (sourceGateX + targetGateX) / 2, y: routeY - 4 },
      });
    }

    let best = candidates[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const points = dedupePoints(candidate.points);
      const intersections = countIntersections(points, item.edge.src_id, item.edge.dst_id);
      const length = pathLength(points);
      const turns = turnsCount(points);
      let deviationPenalty = 0;
      if (candidate.kind === "corridor" && points.length >= 4) {
        const routeY = points[2]?.y;
        if (Number.isFinite(routeY)) {
          deviationPenalty = (Math.abs(routeY - startY) + Math.abs(routeY - endY)) * 0.9;
        }
      }
      const score = intersections * 1_000_000 + length + turns * 6 + deviationPenalty;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
      if (intersections === 0 && score <= bestScore) {
        // Keep searching briefly for the shortest non-intersecting candidate.
        // (We still score length/turns, but this is an early-exit optimization.)
        if (score < 9000) {
          // typical short path
          break;
        }
      }
    }

    const chosenPoints = dedupePoints(best.points);
    const labelX = best.label.x;
    const labelY = best.label.y;
    output[edgeId] = {
      path: pointsToPath(chosenPoints),
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
