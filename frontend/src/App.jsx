import { useEffect, useMemo, useRef, useState } from "react";
import { buildArchitecture, diffArchitecture, fetchModel, healthCheck, runCIGate } from "./api";
import "./App.css";
function clip(text, maxLength) {
  if (!text) {
    return "";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
function charUnits(ch) {
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
function textUnits(text) {
  return Array.from(String(text || "")).reduce((sum, ch) => sum + charUnits(ch), 0);
}
function clipByUnits(text, maxUnits) {
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
function wrapTextByUnits(text, maxUnits, maxLines = 4) {
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
function formatPortText(port) {
  return `${port.protocol || ""} ${port.name || ""}`.trim();
}
function isInterfaceProtocol(protocol) {
  const value = String(protocol || "").toLowerCase();
  if (!value) {
    return false;
  }
  return ["axi", "stream", "bus", "rpc", "http", "grpc", "mq", "topic", "socket", "i2c", "spi", "irq"]
    .some((token) => value.includes(token));
}
function buildNodeVisual(node, ports, summaryText, summarySource) {
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
function nowTimeLabel() {
  return new Date().toLocaleTimeString([], { hour12: false });
}
function humanizeKind(kind) {
  return String(kind || "dependency")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}
function buildModuleLookup(modules) {
  return Object.fromEntries(modules.map((item) => [item.id, item]));
}
function buildChildrenLookup(modules) {
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
function buildEvidenceLookup(evidences) {
  return Object.fromEntries((evidences || []).map((item) => [item.id, item]));
}
function buildDescendantsLookup(modules) {
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
function lineage(moduleId, moduleById) {
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
function ensureSet(items) {
  if (items instanceof Set) {
    return items;
  }
  return new Set(items || []);
}
function hasChildrenInLookup(moduleId, childrenByParent) {
  return (childrenByParent[moduleId] || []).length > 0;
}
function setsEqual(left, right) {
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
function withFocusPathExpanded(expandedModuleIds, focusModuleId, childrenByParent, moduleById, rootModuleId, options = {}) {
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
function collapseExpandedSubtree(expandedModuleIds, moduleId, childrenByParent, rootModuleId) {
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
function representativeInVisibleSet(moduleId, moduleById, visibleIds) {
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
function collectSemanticViewGraph(model, focusModuleId, childrenByParent, moduleById, expandedModuleIds) {
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
  const visibleIds = new Set();
  const contextParentIds = new Set();
  contextParentIds.add(rootId);
  for (let index = 1; index < focusPath.length; index += 1) {
    const parentId = focusPath[index].parent_id;
    if (parentId) {
      contextParentIds.add(parentId);
    }
  }
  for (const parentId of contextParentIds) {
    for (const child of childrenByParent[parentId] || []) {
      visibleIds.add(child.id);
    }
  }
  for (const moduleId of expandedSet) {
    if (!moduleById[moduleId]) {
      continue;
    }
    for (const child of childrenByParent[moduleId] || []) {
      visibleIds.add(child.id);
    }
  }
  for (let index = 1; index < focusPath.length; index += 1) {
    visibleIds.add(focusPath[index].id);
  }
  visibleIds.add(focusModuleId);
  const nodes = Array.from(visibleIds)
    .map((moduleId) => moduleById[moduleId])
    .filter(Boolean)
    .map((module) => {
      const hasFocusPathParent = !!module.parent_id && focusPathIdSet.has(module.parent_id);
      let contextKind = "context";
      if (module.id === focusModuleId) {
        contextKind = "focus";
      } else if (focusPathIdSet.has(module.id)) {
        contextKind = "path";
      } else if (expandedSet.has(module.id)) {
        contextKind = "expanded";
      } else if (hasFocusPathParent) {
        contextKind = "sibling";
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
function computeLayerGraphHints(nodes, edges) {
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
function buildCenterOutOrder(count) {
  if (count <= 1) {
    return [0];
  }
  const middle = (count - 1) / 2;
  return Array.from({ length: count }, (_, index) => index)
    .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle) || a - b);
}
function buildExpandedContainerDefs(nodes, childrenByParent, expandedModuleIds) {
  const visibleById = Object.fromEntries((nodes || []).map((item) => [item.id, item]));
  const expandedSet = ensureSet(expandedModuleIds);
  const defs = [];
  const sorted = [...(nodes || [])].sort((a, b) => (
    a.level - b.level
    || `${a.layer}:${a.name}`.localeCompare(`${b.layer}:${b.name}`)
  ));
  for (const node of sorted) {
    if (!expandedSet.has(node.id) || node.level <= 0) {
      continue;
    }
    const members = new Set([node.id]);
    const queue = [...(childrenByParent[node.id] || [])].map((item) => item.id);
    const visited = new Set();
    while (queue.length) {
      const currentId = queue.shift();
      if (!currentId || visited.has(currentId)) {
        continue;
      }
      visited.add(currentId);
      if (!visibleById[currentId]) {
        continue;
      }
      members.add(currentId);
      for (const child of childrenByParent[currentId] || []) {
        queue.push(child.id);
      }
    }
    if (members.size <= 1) {
      continue;
    }
    defs.push({
      id: node.id,
      name: node.name,
      level: node.level,
      memberIds: Array.from(members),
    });
  }
  return defs;
}
function materializeExpandedContainers(containerDefs, nodeById) {
  const containers = [];
  for (const def of containerDefs || []) {
    const members = def.memberIds
      .map((moduleId) => nodeById[moduleId])
      .filter(Boolean);
    if (members.length <= 1) {
      continue;
    }
    const minX = Math.min(...members.map((item) => item.x));
    const maxX = Math.max(...members.map((item) => item.x + item.width));
    const minY = Math.min(...members.map((item) => item.y));
    const maxY = Math.max(...members.map((item) => item.y + item.height));
    const padX = 28;
    const padTop = 38;
    const padBottom = 24;
    const x = Math.max(8, minX - padX);
    const y = Math.max(8, minY - padTop);
    const width = Math.max(220, maxX - minX + padX * 2);
    const height = Math.max(160, maxY - minY + padTop + padBottom);
    containers.push({
      id: def.id,
      name: def.name,
      level: def.level,
      x,
      y,
      width,
      height,
      memberCount: members.length,
    });
  }
  return containers;
}
function boundsWithPadding(layout, nodes, lanes, moduleContainers) {
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
function layoutGraph(
  nodes,
  edges,
  portsByModule,
  summaryByModule = {},
  summarySourceByModule = {},
  childrenByParent = {},
  expandedModuleIds = new Set(),
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
  const laneHeader = 46;
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
  const containerDefs = buildExpandedContainerDefs(nodes, childrenByParent, expandedModuleIds);
  const nodeById = Object.fromEntries(drawNodes.map((item) => [item.id, item]));
  const moduleContainers = materializeExpandedContainers(containerDefs, nodeById);
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
function snapToGrid(value, grid = 12) {
  return Math.round(value / grid) * grid;
}
function applyManualLayout(layout, manualPositions) {
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
  const moduleContainers = materializeExpandedContainers(layout.containerDefs || [], nodeById);
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
function clampZoom(value) {
  return Math.min(2.8, Math.max(0.35, value));
}
function distributeOnSpan(min, max, index, count) {
  if (count <= 1) {
    return (min + max) / 2;
  }
  const span = Math.max(10, max - min);
  const step = span / (count + 1);
  return min + step * (index + 1);
}
function stableHash(text) {
  let hash = 17;
  for (const ch of Array.from(String(text || ""))) {
    hash = (hash * 31 + (ch.codePointAt(0) || 0)) % 9973;
  }
  return hash;
}
function buildEdgeGeometries(edges, nodeById) {
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
function summarizeModel(model, snapshot) {
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
function App() {
  const [model, setModel] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [serviceStatus, setServiceStatus] = useState("checking");
  const [currentParentId, setCurrentParentId] = useState("");
  const [expandedModuleIds, setExpandedModuleIds] = useState(() => new Set());
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [zoom, setZoom] = useState(1);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [propertiesHidden, setPropertiesHidden] = useState(true);
  const [dockHidden, setDockHidden] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [showEdgeLabels, setShowEdgeLabels] = useState(true);
  const [edgeMinCount, setEdgeMinCount] = useState(1);
  const [edgeScope, setEdgeScope] = useState("all");
  const [edgeFilters, setEdgeFilters] = useState({});
  const [busy, setBusy] = useState({ build: false, diff: false, ci: false, refresh: false });
  const [diffInput, setDiffInput] = useState({ base: "main", head: "HEAD" });
  const [diffReport, setDiffReport] = useState(null);
  const [ciResult, setCiResult] = useState(null);
  const [manualLayouts, setManualLayouts] = useState({});
  const [draggingNodeId, setDraggingNodeId] = useState("");
  const [dragPreview, setDragPreview] = useState(null);
  const [hoverCard, setHoverCard] = useState(null);
  const [hoverNodeId, setHoverNodeId] = useState("");
  const [activePortFocus, setActivePortFocus] = useState(null);
  const [moduleEdits, setModuleEdits] = useState({});
  const [dockTab, setDockTab] = useState("console");
  const [messages, setMessages] = useState([]);
  const [messageFilters, setMessageFilters] = useState({ info: true, warning: true, error: true });
  const [logs, setLogs] = useState([]);
  const [consoleInput, setConsoleInput] = useState("");
  const [consoleHistory, setConsoleHistory] = useState([]);
  const [consoleHistoryIndex, setConsoleHistoryIndex] = useState(-1);
  const svgRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const effectiveModules = useMemo(() => {
    return (model?.modules || []).map((item) => {
      const edit = moduleEdits[item.id] || {};
      const name = typeof edit.name === "string" && edit.name.trim() ? edit.name.trim() : item.name;
      return { ...item, name };
    });
  }, [model, moduleEdits]);
  const moduleById = useMemo(() => buildModuleLookup(effectiveModules), [effectiveModules]);
  const childrenByParent = useMemo(() => buildChildrenLookup(effectiveModules), [effectiveModules]);
  const descendantsByModule = useMemo(() => buildDescendantsLookup(effectiveModules), [effectiveModules]);
  const evidenceById = useMemo(() => buildEvidenceLookup(snapshot?.evidences || []), [snapshot]);
  const systemModule = useMemo(() => {
    const modules = effectiveModules || [];
    const explicit = modules.find((item) => item.level === 0 && !item.parent_id);
    if (explicit) {
      return explicit;
    }
    const sorted = [...modules].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
    return sorted[0] || null;
  }, [effectiveModules]);
  const portsByModule = useMemo(() => {
    const output = {};
    for (const port of model?.ports || []) {
      if (!output[port.module_id]) {
        output[port.module_id] = [];
      }
      output[port.module_id].push(port);
    }
    return output;
  }, [model]);
  const stats = useMemo(() => summarizeModel(model, snapshot), [model, snapshot]);
  const llmSummaries = useMemo(() => {
    const base = { ...(model?.metadata?.llm_summaries || {}) };
    for (const [moduleId, edit] of Object.entries(moduleEdits)) {
      if (typeof edit.summary === "string") {
        base[moduleId] = edit.summary;
      }
    }
    return base;
  }, [model, moduleEdits]);
  const llmSummarySource = useMemo(() => {
    const base = { ...(model?.metadata?.llm_summary_source || {}) };
    for (const [moduleId, edit] of Object.entries(moduleEdits)) {
      if (typeof edit.summary === "string") {
        base[moduleId] = "manual";
      }
    }
    return base;
  }, [model, moduleEdits]);
  const viewGraph = useMemo(
    () => collectSemanticViewGraph(model, currentParentId, childrenByParent, moduleById, expandedModuleIds),
    [model, currentParentId, childrenByParent, moduleById, expandedModuleIds],
  );
  const edgeKinds = useMemo(() => {
    return Array.from(new Set((model?.edges || []).map((item) => item.kind))).sort();
  }, [model]);
  useEffect(() => {
    setEdgeFilters((old) => {
      const next = {};
      for (const kind of edgeKinds) {
        next[kind] = old[kind] ?? true;
      }
      return next;
    });
  }, [edgeKinds]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("archsync.sidebarHidden");
      setSidebarHidden(raw === "1");
      const propertiesRaw = window.localStorage.getItem("archsync.propertiesHidden");
      if (propertiesRaw === "0") {
        setPropertiesHidden(false);
      }
      const dockRaw = window.localStorage.getItem("archsync.dockHidden");
      if (dockRaw === "0") {
        setDockHidden(false);
      }
      const focusRaw = window.localStorage.getItem("archsync.focusMode");
      if (focusRaw === "1") {
        setFocusMode(true);
      }
      const savedDockTab = window.localStorage.getItem("archsync.dockTab");
      if (savedDockTab && ["console", "messages", "log"].includes(savedDockTab)) {
        setDockTab(savedDockTab);
      }
      const savedLabelFlag = window.localStorage.getItem("archsync.showEdgeLabels");
      if (savedLabelFlag === "0") {
        setShowEdgeLabels(false);
      }
      const savedEdgeMinCount = Number.parseInt(window.localStorage.getItem("archsync.edgeMinCount") || "1", 10);
      if (Number.isFinite(savedEdgeMinCount) && savedEdgeMinCount > 0) {
        setEdgeMinCount(savedEdgeMinCount);
      }
      const savedEdgeScope = window.localStorage.getItem("archsync.edgeScope");
      if (savedEdgeScope === "selected" || savedEdgeScope === "all") {
        setEdgeScope(savedEdgeScope);
      }
      const savedZoom = Number(window.localStorage.getItem("archsync.zoom") || "");
      if (Number.isFinite(savedZoom) && savedZoom > 0) {
        setZoom(clampZoom(savedZoom));
      }
      const savedMessageFiltersRaw = window.localStorage.getItem("archsync.messageFilters");
      if (savedMessageFiltersRaw) {
        const parsed = JSON.parse(savedMessageFiltersRaw);
        if (parsed && typeof parsed === "object") {
          setMessageFilters((old) => ({
            ...old,
            info: parsed.info !== false,
            warning: parsed.warning !== false,
            error: parsed.error !== false,
          }));
        }
      }
      const savedEdgeFiltersRaw = window.localStorage.getItem("archsync.edgeFilters");
      if (savedEdgeFiltersRaw) {
        const parsed = JSON.parse(savedEdgeFiltersRaw);
        if (parsed && typeof parsed === "object") {
          setEdgeFilters((old) => ({ ...old, ...parsed }));
        }
      }
    } catch {
      setSidebarHidden(false);
      setPropertiesHidden(true);
      setDockHidden(true);
      setFocusMode(false);
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem("archsync.sidebarHidden", sidebarHidden ? "1" : "0");
    } catch {
      // ignore storage errors
    }
  }, [sidebarHidden]);
  useEffect(() => {
    try {
      window.localStorage.setItem("archsync.propertiesHidden", propertiesHidden ? "1" : "0");
    } catch {
      // ignore storage errors
    }
  }, [propertiesHidden]);
  useEffect(() => {
    try {
      window.localStorage.setItem("archsync.dockHidden", dockHidden ? "1" : "0");
    } catch {
      // ignore storage errors
    }
  }, [dockHidden]);
  useEffect(() => {
    try {
      window.localStorage.setItem("archsync.focusMode", focusMode ? "1" : "0");
    } catch {
      // ignore storage errors
    }
  }, [focusMode]);
  useEffect(() => {
    try {
      window.localStorage.setItem("archsync.dockTab", dockTab);
    } catch {
      // ignore storage errors
    }
  }, [dockTab]);
  useEffect(() => {
    try {
      window.localStorage.setItem("archsync.showEdgeLabels", showEdgeLabels ? "1" : "0");
    } catch {
      // ignore storage errors
    }
  }, [showEdgeLabels]);
  useEffect(() => {
    try {
      window.localStorage.setItem("archsync.edgeMinCount", String(Math.max(1, edgeMinCount)));
    } catch {
      // ignore storage errors
    }
  }, [edgeMinCount]);
  useEffect(() => {
    try {
      window.localStorage.setItem("archsync.edgeScope", edgeScope);
    } catch {
      // ignore storage errors
    }
  }, [edgeScope]);
  useEffect(() => {
    try {
      window.localStorage.setItem("archsync.zoom", String(zoom));
    } catch {
      // ignore storage errors
    }
  }, [zoom]);
  useEffect(() => {
    try {
      window.localStorage.setItem("archsync.messageFilters", JSON.stringify(messageFilters));
    } catch {
      // ignore storage errors
    }
  }, [messageFilters]);
  useEffect(() => {
    try {
      window.localStorage.setItem("archsync.edgeFilters", JSON.stringify(edgeFilters));
    } catch {
      // ignore storage errors
    }
  }, [edgeFilters]);
  const maxEdgeCount = useMemo(
    () => Math.max(1, ...viewGraph.edges.map((edge) => Math.max(1, Number(edge.count) || 1))),
    [viewGraph.edges],
  );
  const effectiveEdgeMinCount = Math.min(Math.max(1, edgeMinCount), maxEdgeCount);
  const selectedInCurrentDepth = useMemo(
    () => !!selectedModuleId && viewGraph.nodes.some((item) => item.id === selectedModuleId),
    [selectedModuleId, viewGraph.nodes],
  );
  useEffect(() => {
    if (edgeScope === "selected" && !selectedInCurrentDepth) {
      setEdgeScope("all");
    }
  }, [edgeScope, selectedInCurrentDepth]);
  const visibleEdges = useMemo(
    () => viewGraph.edges
      .filter((edge) => edgeFilters[edge.kind] !== false)
      .filter((edge) => (Number(edge.count) || 1) >= effectiveEdgeMinCount)
      .filter((edge) => {
        if (edgeScope !== "selected" || !selectedInCurrentDepth) {
          return true;
        }
        return edge.src_id === selectedModuleId || edge.dst_id === selectedModuleId;
      }),
    [viewGraph.edges, edgeFilters, effectiveEdgeMinCount, edgeScope, selectedInCurrentDepth, selectedModuleId],
  );
  const autoLayout = useMemo(
    () => layoutGraph(
      viewGraph.nodes,
      visibleEdges,
      portsByModule,
      llmSummaries,
      llmSummarySource,
      childrenByParent,
      expandedModuleIds,
    ),
    [
      viewGraph.nodes,
      visibleEdges,
      portsByModule,
      llmSummaries,
      llmSummarySource,
      childrenByParent,
      expandedModuleIds,
    ],
  );
  const manualPositionsForCurrent = useMemo(
    () => (currentParentId ? manualLayouts[currentParentId] || {} : {}),
    [manualLayouts, currentParentId],
  );
  const layout = useMemo(
    () => applyManualLayout(autoLayout, manualPositionsForCurrent),
    [autoLayout, manualPositionsForCurrent],
  );
  const renderLayout = useMemo(() => {
    if (!dragPreview || dragPreview.parentId !== currentParentId) {
      return layout;
    }
    return applyManualLayout(layout, {
      [dragPreview.nodeId]: { x: dragPreview.x, y: dragPreview.y },
    });
  }, [layout, dragPreview, currentParentId]);
  const drawNodeById = useMemo(
    () => Object.fromEntries(renderLayout.nodes.map((item) => [item.id, item])),
    [renderLayout.nodes],
  );
  const edgeGeometryById = useMemo(
    () => buildEdgeGeometries(visibleEdges, drawNodeById),
    [visibleEdges, drawNodeById],
  );
  const availableLevels = useMemo(() => {
    return Array.from(
      new Set((effectiveModules || []).filter((item) => item.level > 0).map((item) => item.level)),
    ).sort((a, b) => a - b);
  }, [effectiveModules]);
  const filteredModules = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return (effectiveModules || [])
      .filter((item) => item.level > 0)
      .filter((item) => levelFilter === "all" || String(item.level) === levelFilter)
      .filter((item) => {
        if (!query) {
          return true;
        }
        return (
          item.name.toLowerCase().includes(query)
          || item.layer.toLowerCase().includes(query)
          || item.path.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        if (a.level !== b.level) {
          return a.level - b.level;
        }
        return `${a.layer}:${a.name}`.localeCompare(`${b.layer}:${b.name}`);
      });
  }, [effectiveModules, searchQuery, levelFilter]);
  const selectedModule = selectedModuleId ? moduleById[selectedModuleId] : null;
  const selectedModulePorts = useMemo(() => {
    if (!selectedModule) {
      return [];
    }
    const includeIds = descendantsByModule[selectedModule.id] || new Set([selectedModule.id]);
    const output = [];
    for (const moduleId of includeIds) {
      for (const port of portsByModule[moduleId] || []) {
        output.push(port);
      }
    }
    return output.sort((a, b) => {
      const keyA = `${a.direction}:${a.protocol}:${a.name}`;
      const keyB = `${b.direction}:${b.protocol}:${b.name}`;
      return keyA.localeCompare(keyB);
    });
  }, [selectedModule, descendantsByModule, portsByModule]);
  const selectedModuleSummary = useMemo(() => {
    if (!selectedModule) {
      return "";
    }
    const path = lineage(selectedModule.id, moduleById).reverse();
    for (const item of path) {
      const text = llmSummaries[item.id];
      if (text) {
        return text;
      }
    }
    return "";
  }, [selectedModule, moduleById, llmSummaries]);
  const selectedModuleSummarySource = useMemo(() => {
    if (!selectedModule) {
      return "";
    }
    const path = lineage(selectedModule.id, moduleById).reverse();
    for (const item of path) {
      const text = llmSummaries[item.id];
      if (text) {
        return llmSummarySource[item.id] || "fallback";
      }
    }
    return "";
  }, [selectedModule, moduleById, llmSummaries, llmSummarySource]);
  const selectedConnections = useMemo(() => {
    if (!selectedModuleId) {
      return { incoming: [], outgoing: [] };
    }
    const incoming = [];
    const outgoing = [];
    for (const edge of model?.edges || []) {
      if (edge.dst_id === selectedModuleId) {
        const sourceName = moduleById[edge.src_id]?.name || edge.src_id;
        incoming.push(`${sourceName} · ${humanizeKind(edge.kind)} · ${edge.label}`);
      }
      if (edge.src_id === selectedModuleId) {
        const targetName = moduleById[edge.dst_id]?.name || edge.dst_id;
        outgoing.push(`${targetName} · ${humanizeKind(edge.kind)} · ${edge.label}`);
      }
    }
    return { incoming, outgoing };
  }, [model, moduleById, selectedModuleId]);
  const breadcrumb = useMemo(
    () => (currentParentId ? lineage(currentParentId, moduleById) : []),
    [currentParentId, moduleById],
  );
  const currentDepth = useMemo(() => {
    if (!currentParentId || !moduleById[currentParentId]) {
      return 0;
    }
    return moduleById[currentParentId].level;
  }, [currentParentId, moduleById]);
  const selectedIsVisible = selectedInCurrentDepth;
  const visibleEdgeRows = useMemo(
    () => visibleEdges.map((edge) => ({
      ...edge,
      srcName: moduleById[edge.src_id]?.name || edge.src_id,
      dstName: moduleById[edge.dst_id]?.name || edge.dst_id,
    })),
    [visibleEdges, moduleById],
  );
  const selectedEdge = useMemo(
    () => visibleEdgeRows.find((item) => item.id === selectedEdgeId) || null,
    [visibleEdgeRows, selectedEdgeId],
  );
  const denseLabelMode = visibleEdges.length > 40;
  const messageCounts = useMemo(() => {
    const counts = { info: 0, warning: 0, error: 0 };
    for (const message of messages) {
      if (counts[message.severity] !== undefined) {
        counts[message.severity] += 1;
      }
    }
    return counts;
  }, [messages]);
  const filteredMessages = useMemo(() => {
    return messages.filter((item) => messageFilters[item.severity] !== false);
  }, [messages, messageFilters]);
  const hoverContext = useMemo(() => {
    if (!hoverNodeId) {
      return { edgeIds: new Set(), neighborIds: new Set() };
    }
    const edgeIds = new Set();
    const neighborIds = new Set();
    for (const edge of visibleEdges) {
      if (edge.src_id === hoverNodeId || edge.dst_id === hoverNodeId) {
        edgeIds.add(edge.id);
        if (edge.src_id !== hoverNodeId) {
          neighborIds.add(edge.src_id);
        }
        if (edge.dst_id !== hoverNodeId) {
          neighborIds.add(edge.dst_id);
        }
      }
    }
    return { edgeIds, neighborIds };
  }, [hoverNodeId, visibleEdges]);
  function appendLog(text, severity = "info") {
    const item = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: nowTimeLabel(),
      severity,
      text: String(text || ""),
    };
    setLogs((old) => [...old.slice(-399), item]);
  }
  function appendMessage(severity, text, source = "studio") {
    const normalized = ["info", "warning", "error"].includes(severity) ? severity : "info";
    const item = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: nowTimeLabel(),
      severity: normalized,
      source,
      text: String(text || ""),
    };
    setMessages((old) => [...old.slice(-399), item]);
    appendLog(`${normalized.toUpperCase()} ${item.text}`, normalized);
  }
  useEffect(() => {
    if (!selectedEdgeId) {
      return;
    }
    if (!visibleEdges.some((item) => item.id === selectedEdgeId)) {
      setSelectedEdgeId("");
    }
  }, [visibleEdges, selectedEdgeId]);
  const selectedModuleEdit = selectedModuleId ? (moduleEdits[selectedModuleId] || {}) : {};
  const selectedParams = Array.isArray(selectedModuleEdit.params) ? selectedModuleEdit.params : [];
  const candidateDirection = activePortFocus
    ? (activePortFocus.direction === "in" ? "out" : "in")
    : "";
  function getPortVisualState(nodeId, port, direction) {
    if (!activePortFocus) {
      return "normal";
    }
    const portId = port.id || `${direction}-${port.name}-${port.protocol}`;
    if (activePortFocus.nodeId === nodeId && activePortFocus.portId === portId) {
      return "active";
    }
    const connectable = direction === candidateDirection && activePortFocus.nodeId !== nodeId;
    return connectable ? "candidate" : "blocked";
  }
  function patchSelectedModuleEdit(patch) {
    if (!selectedModuleId) {
      return;
    }
    setModuleEdits((old) => ({
      ...old,
      [selectedModuleId]: {
        ...(old[selectedModuleId] || {}),
        ...patch,
      },
    }));
  }
  function upsertParam(index, field, value) {
    if (!selectedModuleId) {
      return;
    }
    setModuleEdits((old) => {
      const current = old[selectedModuleId] || {};
      const list = Array.isArray(current.params) ? [...current.params] : [];
      if (!list[index]) {
        list[index] = { key: "", value: "" };
      }
      list[index] = { ...list[index], [field]: value };
      return {
        ...old,
        [selectedModuleId]: {
          ...current,
          params: list,
        },
      };
    });
  }
  function addParamRow() {
    if (!selectedModuleId) {
      return;
    }
    setModuleEdits((old) => {
      const current = old[selectedModuleId] || {};
      const list = Array.isArray(current.params) ? [...current.params] : [];
      list.push({ key: "", value: "" });
      return {
        ...old,
        [selectedModuleId]: {
          ...current,
          params: list,
        },
      };
    });
  }
  function removeParamRow(index) {
    if (!selectedModuleId) {
      return;
    }
    setModuleEdits((old) => {
      const current = old[selectedModuleId] || {};
      const list = Array.isArray(current.params) ? [...current.params] : [];
      list.splice(index, 1);
      return {
        ...old,
        [selectedModuleId]: {
          ...current,
          params: list,
        },
      };
    });
  }
  function resetSelectedModuleOverrides() {
    if (!selectedModuleId) {
      return;
    }
    setModuleEdits((old) => {
      if (!old[selectedModuleId]) {
        return old;
      }
      const next = { ...old };
      delete next[selectedModuleId];
      return next;
    });
  }
  function setNodeManualPosition(nodeId, x, y) {
    if (!currentParentId) {
      return;
    }
    setManualLayouts((old) => ({
      ...old,
      [currentParentId]: {
        ...(old[currentParentId] || {}),
        [nodeId]: { x, y },
      },
    }));
  }
  function resetCurrentLayout() {
    if (!currentParentId) {
      return;
    }
    setDragPreview(null);
    setManualLayouts((old) => {
      if (!old[currentParentId]) {
        return old;
      }
      const next = { ...old };
      delete next[currentParentId];
      return next;
    });
  }
  function resetAllLayouts() {
    setDragPreview(null);
    setManualLayouts({});
  }
  function showNodeHover(event, nodeId) {
    setHoverNodeId(nodeId);
    const summary = llmSummaries[nodeId];
    if (!summary) {
      setHoverCard(null);
      return;
    }
    setHoverCard({
      nodeId,
      x: event.clientX + 14,
      y: event.clientY + 14,
    });
  }
  function moveNodeHover(event, nodeId) {
    setHoverCard((old) => {
      if (!old || old.nodeId !== nodeId) {
        return old;
      }
      return {
        ...old,
        x: event.clientX + 14,
        y: event.clientY + 14,
      };
    });
  }
  function hideNodeHover(nodeId) {
    setHoverNodeId((old) => (old === nodeId ? "" : old));
    setHoverCard((old) => {
      if (!old || old.nodeId !== nodeId) {
        return old;
      }
      return null;
    });
  }
  function toSvgPoint(clientX, clientY) {
    const svg = svgRef.current;
    if (!svg) {
      return null;
    }
    const ctm = svg.getScreenCTM();
    if (!ctm) {
      return null;
    }
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }
  function startNodeDrag(event, node) {
    if (!currentParentId || event.button !== 0) {
      return;
    }
    const point = toSvgPoint(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      parentId: currentParentId,
      nodeId: node.id,
      width: node.width,
      height: node.height,
      offsetX: point.x - node.x,
      offsetY: point.y - node.y,
      lastX: node.x,
      lastY: node.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDraggingNodeId(node.id);
    setDragPreview({
      parentId: currentParentId,
      nodeId: node.id,
      x: node.x,
      y: node.y,
    });
    setHoverCard(null);
    event.stopPropagation();
  }
  function moveNodeDrag(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.parentId !== currentParentId) {
      return;
    }
    const point = toSvgPoint(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    const minX = 16;
    const minY = 58;
    const maxX = Math.max(minX, renderLayout.width - drag.width - 16);
    const maxY = Math.max(minY, renderLayout.height - drag.height - 16);
    const nextX = Math.min(maxX, Math.max(minX, snapToGrid(point.x - drag.offsetX)));
    const nextY = Math.min(maxY, Math.max(minY, snapToGrid(point.y - drag.offsetY)));
    const currentNode = drawNodeById[drag.nodeId];
    if (!currentNode) {
      return;
    }
    if (Math.abs(currentNode.x - nextX) > 1 || Math.abs(currentNode.y - nextY) > 1) {
      drag.moved = true;
      drag.lastX = nextX;
      drag.lastY = nextY;
      setDragPreview({
        parentId: drag.parentId,
        nodeId: drag.nodeId,
        x: nextX,
        y: nextY,
      });
    }
  }
  function finishNodeDrag(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    if (drag.moved) {
      suppressClickRef.current = true;
      if (drag.parentId === currentParentId) {
        setNodeManualPosition(drag.nodeId, drag.lastX, drag.lastY);
      }
    }
    dragRef.current = null;
    setDragPreview(null);
    setDraggingNodeId("");
  }
  function hasChildren(moduleId) {
    return (childrenByParent[moduleId] || []).length > 0;
  }
  function focusModule(moduleId) {
    const module = moduleById[moduleId];
    if (!module) {
      return;
    }
    setSelectedEdgeId("");
    setActivePortFocus(null);
    setCurrentParentId(moduleId);
    setSelectedModuleId(moduleId);
    setExpandedModuleIds((old) => {
      const next = withFocusPathExpanded(
        old,
        moduleId,
        childrenByParent,
        moduleById,
        systemModule?.id || "",
        { includeSelf: true },
      );
      return setsEqual(next, old) ? old : next;
    });
  }
  function toggleModuleExpand(moduleId) {
    if (!moduleById[moduleId] || !hasChildren(moduleId)) {
      focusModule(moduleId);
      return;
    }
    setSelectedEdgeId("");
    setActivePortFocus(null);
    setCurrentParentId(moduleId);
    setSelectedModuleId(moduleId);
    setExpandedModuleIds((old) => {
      let next;
      if (old.has(moduleId)) {
        next = collapseExpandedSubtree(old, moduleId, childrenByParent, systemModule?.id || "");
      } else {
        next = new Set(old);
        next.add(moduleId);
      }
      next = withFocusPathExpanded(
        next,
        moduleId,
        childrenByParent,
        moduleById,
        systemModule?.id || "",
      );
      return setsEqual(next, old) ? old : next;
    });
  }
  function expandOuterDirection(moduleId, direction) {
    if (!moduleById[moduleId] || !["in", "out"].includes(direction)) {
      return;
    }
    const node = viewGraph.nodes.find((item) => item.id === moduleId);
    if (!node) {
      return;
    }
    const targets = direction === "in" ? (node.outerInParentIds || []) : (node.outerOutParentIds || []);
    if (!targets.length) {
      return;
    }
    setSelectedEdgeId("");
    setActivePortFocus(null);
    setCurrentParentId(moduleId);
    setSelectedModuleId(moduleId);
    setExpandedModuleIds((old) => {
      let next = withFocusPathExpanded(
        old,
        moduleId,
        childrenByParent,
        moduleById,
        systemModule?.id || "",
      );
      for (const targetId of targets) {
        if (moduleById[targetId] && hasChildren(targetId)) {
          next.add(targetId);
        }
      }
      return setsEqual(next, old) ? old : next;
    });
  }
  function activateNode(moduleId) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    focusModule(moduleId);
  }
  async function refreshModel(autoBuild = true) {
    setBusy((old) => ({ ...old, refresh: true }));
    setError("");
    try {
      const response = await fetchModel({ autoBuild });
      setModel(response.model);
      setSnapshot(response.snapshot);
      appendMessage("info", `Model refreshed (${autoBuild ? "auto build" : "model only"}).`, "refresh");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      appendMessage("error", message, "refresh");
    } finally {
      setBusy((old) => ({ ...old, refresh: false }));
    }
  }
  async function triggerBuild() {
    setBusy((old) => ({ ...old, build: true }));
    setError("");
    try {
      const response = await buildArchitecture({ full: true });
      setModel(response.model);
      appendMessage("info", "Build completed.", "build");
      await refreshModel(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      appendMessage("error", message, "build");
    } finally {
      setBusy((old) => ({ ...old, build: false }));
    }
  }
  async function triggerDiff() {
    setBusy((old) => ({ ...old, diff: true }));
    setError("");
    try {
      const response = await diffArchitecture({ base: diffInput.base, head: diffInput.head });
      setDiffReport(response.report);
      const violations = response.report?.violations?.length || 0;
      appendMessage(violations ? "warning" : "info", `Diff ready: ${violations} violation(s).`, "diff");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      appendMessage("error", message, "diff");
    } finally {
      setBusy((old) => ({ ...old, diff: false }));
    }
  }
  async function triggerCIGate() {
    setBusy((old) => ({ ...old, ci: true }));
    setError("");
    try {
      const response = await runCIGate({ base: diffInput.base, head: diffInput.head, failOn: "high" });
      setCiResult(response);
      appendMessage(response.ok ? "info" : "error", `CI Gate ${response.ok ? "PASS" : "FAIL"}.`, "ci");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      appendMessage("error", message, "ci");
    } finally {
      setBusy((old) => ({ ...old, ci: false }));
    }
  }
  function drillUpOneLevel() {
    const currentParent = moduleById[currentParentId];
    if (!currentParent || !currentParent.parent_id) {
      return;
    }
    focusModule(currentParent.parent_id);
  }
  function jumpToCrumb(moduleId) {
    focusModule(moduleId);
  }
  function toggleEdgeKind(kind) {
    setEdgeFilters((old) => ({ ...old, [kind]: !(old[kind] ?? true) }));
  }
  useEffect(() => {
    async function bootstrap() {
      try {
        await healthCheck();
        setServiceStatus("online");
        appendMessage("info", "API health check: online.", "health");
      } catch {
        setServiceStatus("offline");
        appendMessage("warning", "API health check: offline.", "health");
      }
      await refreshModel(true);
    }
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!systemModule) {
      return;
    }
    const focusId = currentParentId && moduleById[currentParentId] ? currentParentId : systemModule.id;
    const selectedId = selectedModuleId && moduleById[selectedModuleId] ? selectedModuleId : focusId;
    if (focusId !== currentParentId) {
      setCurrentParentId(focusId);
    }
    if (selectedId !== selectedModuleId) {
      setSelectedModuleId(selectedId);
    }
    setExpandedModuleIds((old) => {
      const validIds = new Set(Object.keys(moduleById));
      const pruned = new Set(Array.from(old).filter((id) => validIds.has(id)));
      const next = withFocusPathExpanded(
        pruned,
        focusId,
        childrenByParent,
        moduleById,
        systemModule.id,
      );
      return setsEqual(next, old) ? old : next;
    });
  }, [systemModule, moduleById, childrenByParent, currentParentId, selectedModuleId]);
  useEffect(() => {
    setSelectedEdgeId("");
    setActivePortFocus(null);
    setHoverNodeId("");
    dragRef.current = null;
    setDraggingNodeId("");
    setDragPreview(null);
    setHoverCard(null);
  }, [currentParentId]);
  function zoomToFit() {
    const wrap = canvasWrapRef.current;
    if (!wrap || !renderLayout.width || !renderLayout.height) {
      return;
    }
    const padding = 28;
    const fitX = (wrap.clientWidth - padding) / renderLayout.width;
    const fitY = (wrap.clientHeight - padding) / renderLayout.height;
    const target = clampZoom(Math.min(fitX, fitY));
    setZoom(target);
    appendMessage("info", `Zoom to fit: ${Math.round(target * 100)}%.`, "console");
  }
  function exportCurrentSvg() {
    const sourceSvg = svgRef.current;
    if (!sourceSvg) {
      appendMessage("error", "No diagram available to export.", "console");
      return;
    }
    try {
      const clone = sourceSvg.cloneNode(true);
      clone.removeAttribute("style");
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
      const serialized = new XMLSerializer().serializeToString(clone);
      const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "");
      const filename = `archsync-depth${currentDepth}-${stamp}.svg`;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = "none";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      appendMessage("info", `Exported SVG: ${filename}`, "console");
    } catch (err) {
      appendMessage("error", `Export failed: ${err instanceof Error ? err.message : String(err)}`, "console");
    }
  }
  async function runConsoleCommand(rawInput) {
    const line = String(rawInput || "").trim();
    if (!line) {
      return;
    }
    const [command] = line.split(/\s+/);
    const cmd = command.toLowerCase();
    appendLog(`> ${line}`, "info");
    if (cmd === "help") {
      appendMessage("info", "Commands: help, reload, zoomfit, export, diff", "console");
      return;
    }
    if (cmd === "reload") {
      await refreshModel(true);
      return;
    }
    if (cmd === "zoomfit") {
      zoomToFit();
      return;
    }
    if (cmd === "export") {
      exportCurrentSvg();
      return;
    }
    if (cmd === "diff") {
      await triggerDiff();
      return;
    }
    appendMessage("error", `Unknown command: ${cmd}`, "console");
  }
  async function submitConsoleInput() {
    const line = consoleInput.trim();
    if (!line) {
      return;
    }
    setConsoleHistory((old) => [...old.slice(-199), line]);
    setConsoleHistoryIndex(-1);
    setConsoleInput("");
    await runConsoleCommand(line);
  }
  function handleConsoleKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      submitConsoleInput().catch(() => {});
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!consoleHistory.length) {
        return;
      }
      const nextIndex = consoleHistoryIndex < 0 ? consoleHistory.length - 1 : Math.max(0, consoleHistoryIndex - 1);
      setConsoleHistoryIndex(nextIndex);
      setConsoleInput(consoleHistory[nextIndex] || "");
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!consoleHistory.length) {
        return;
      }
      if (consoleHistoryIndex < 0) {
        return;
      }
      const nextIndex = consoleHistoryIndex + 1;
      if (nextIndex >= consoleHistory.length) {
        setConsoleHistoryIndex(-1);
        setConsoleInput("");
        return;
      }
      setConsoleHistoryIndex(nextIndex);
      setConsoleInput(consoleHistory[nextIndex] || "");
    }
  }
  function handleCanvasWheel(event) {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.08 : 0.92;
    setZoom((value) => clampZoom(value * factor));
  }
  return (
    <div className={`studio ${(sidebarHidden || focusMode) ? "sidebar-hidden" : ""} ${focusMode ? "focus-mode" : ""}`}>
      {!sidebarHidden && !focusMode && (
      <aside className="studio-sidebar">
        <header className="brand">
          <h1>ArchSync Studio</h1>
          <p>Interface-first architecture review console for AI-generated code</p>
          <div className={`service service-${serviceStatus}`}>
            API: {serviceStatus.toUpperCase()}
          </div>
        </header>
        <section className="action-row">
          <button type="button" onClick={triggerBuild} disabled={busy.build}>
            {busy.build ? "Building…" : "Build"}
          </button>
          <button type="button" onClick={() => refreshModel(true)} disabled={busy.refresh}>
            {busy.refresh ? "Refreshing…" : "Refresh"}
          </button>
        </section>
        <section className="metrics">
          <article><span>{stats.modules}</span><small>modules</small></article>
          <article><span>{stats.ports}</span><small>ports</small></article>
          <article><span>{stats.edges}</span><small>edges</small></article>
          <article><span>{stats.evidences}</span><small>evidence</small></article>
          <article><span>{stats.analyzedFiles}</span><small>analyzed files</small></article>
          <article><span>{stats.eligibleFiles ? `${stats.coveragePct}%` : "0%"}</span><small>coverage</small></article>
        </section>
        <section className="panel">
          <label htmlFor="search">Search</label>
          <input
            id="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="module / layer / path"
          />
          <label htmlFor="level-filter">Level</label>
          <select
            id="level-filter"
            value={levelFilter}
            onChange={(event) => setLevelFilter(event.target.value)}
          >
            <option value="all">All</option>
            {availableLevels.map((level) => (
              <option key={level} value={String(level)}>L{level}</option>
            ))}
          </select>
          <div className="edge-filters">
            {edgeKinds.map((kind) => (
              <button
                key={kind}
                type="button"
                className={edgeFilters[kind] !== false ? "active" : ""}
                onClick={() => toggleEdgeKind(kind)}
              >
                {humanizeKind(kind)}
              </button>
            ))}
            {!edgeKinds.length && <p className="empty">No edge kinds available.</p>}
          </div>
        </section>
        <section className="module-list">
          {filteredModules.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`module-item ${selectedModuleId === item.id ? "active" : ""}`}
              onClick={() => focusModule(item.id)}
            >
              <strong>{item.name}</strong>
              <span>{item.layer} · L{item.level}</span>
            </button>
          ))}
          {!filteredModules.length && <p className="empty">No module matches your filter.</p>}
        </section>
        <section className="details">
          {selectedModule ? (
            <>
              <h3>{selectedModule.name}</h3>
              <p>{selectedModule.layer} · L{selectedModule.level}</p>
              {!!selectedModuleSummary && (
                <>
                  <p className="summary">{selectedModuleSummary}</p>
                  <p className={`summary-source ${selectedModuleSummarySource === "llm" ? "llm" : "fallback"}`}>
                    {selectedModuleSummarySource === "llm" ? "来源: Local LLM" : "来源: 规则回退"}
                  </p>
                </>
              )}
              <h4>Ports</h4>
              <ul>
                {selectedModulePorts.slice(0, 16).map((port) => {
                  const evidenceId = port.evidence_ids?.[0];
                  const evidence = evidenceId ? evidenceById[evidenceId] : null;
                  return (
                    <li key={port.id}>
                      <strong>{String(port.direction).toUpperCase()}</strong> {port.protocol} {port.name}
                      {port.details && <small>{port.details}</small>}
                      {evidence && (
                        <small className="evidence">
                          {evidence.file_path}:{evidence.line_start}
                        </small>
                      )}
                    </li>
                  );
                })}
                {!selectedModulePorts.length && <li>None</li>}
              </ul>
              <div className="io-grid">
                <div>
                  <h4>Incoming</h4>
                  <ul>
                    {selectedConnections.incoming.slice(0, 8).map((name) => <li key={name}>{name}</li>)}
                    {!selectedConnections.incoming.length && <li>None</li>}
                  </ul>
                </div>
                <div>
                  <h4>Outgoing</h4>
                  <ul>
                    {selectedConnections.outgoing.slice(0, 8).map((name) => <li key={name}>{name}</li>)}
                    {!selectedConnections.outgoing.length && <li>None</li>}
                  </ul>
                </div>
              </div>
            </>
          ) : (
            <p>Select a module to inspect ports and links.</p>
          )}
        </section>
      </aside>
      )}
      <main className="studio-main">
        <div className="toolbar">
          <div className="toolbar-left">
            <button type="button" onClick={() => setSidebarHidden((value) => !value)} disabled={focusMode}>
              {sidebarHidden || focusMode ? "Show Sidebar" : "Hide Sidebar"}
            </button>
            <button type="button" onClick={() => setPropertiesHidden((value) => !value)} disabled={focusMode}>
              {propertiesHidden || focusMode ? "Show Properties" : "Hide Properties"}
            </button>
            <button type="button" onClick={() => setDockHidden((value) => !value)} disabled={focusMode}>
              {dockHidden || focusMode ? "Show Panel" : "Hide Panel"}
            </button>
            <button
              type="button"
              className={focusMode ? "active-focus-toggle" : ""}
              onClick={() => {
                setFocusMode((value) => {
                  const next = !value;
                  if (next) {
                    setSidebarHidden(true);
                    setPropertiesHidden(true);
                    setDockHidden(true);
                  }
                  return next;
                });
              }}
            >
              {focusMode ? "Exit Focus" : "Focus Mode"}
            </button>
            <button type="button" onClick={() => setZoom((value) => clampZoom(value - 0.1))}>-</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoom((value) => clampZoom(value + 0.1))}>+</button>
            <button type="button" onClick={zoomToFit}>Zoom Fit</button>
            <span className="zoom-hint">Ctrl+Wheel Zoom</span>
            <button type="button" onClick={resetCurrentLayout}>Auto Layout</button>
            <button type="button" onClick={resetAllLayouts}>Reset All</button>
            <button type="button" onClick={() => setShowEdgeLabels((old) => !old)}>
              {showEdgeLabels ? "Hide Labels" : "Show Labels"}
            </button>
            <button type="button" onClick={exportCurrentSvg}>Export SVG</button>
            <div className="edge-density-control">
              <label htmlFor="edge-min-count">Min Link Weight</label>
              <input
                id="edge-min-count"
                type="range"
                min={1}
                max={maxEdgeCount}
                value={effectiveEdgeMinCount}
                onChange={(event) => setEdgeMinCount(Number.parseInt(event.target.value, 10) || 1)}
              />
              <span>x{effectiveEdgeMinCount}</span>
            </div>
            <div className="edge-scope-toggle" role="group" aria-label="Edge scope">
              <button
                type="button"
                className={edgeScope === "all" ? "active" : ""}
                onClick={() => setEdgeScope("all")}
              >
                All Links
              </button>
              <button
                type="button"
                className={edgeScope === "selected" ? "active" : ""}
                onClick={() => setEdgeScope("selected")}
                disabled={!selectedInCurrentDepth}
              >
                Selected Only
              </button>
            </div>
            {edgeKinds.map((kind) => (
              <span key={kind} className={`legend-item legend-${kind} ${edgeFilters[kind] !== false ? "active" : ""}`}>
                {humanizeKind(kind)}
              </span>
            ))}
          </div>
          <div className="toolbar-right">
            <input
              value={diffInput.base}
              onChange={(event) => setDiffInput((old) => ({ ...old, base: event.target.value }))}
              placeholder="base"
            />
            <input
              value={diffInput.head}
              onChange={(event) => setDiffInput((old) => ({ ...old, head: event.target.value }))}
              placeholder="head"
            />
            <button type="button" onClick={triggerDiff} disabled={busy.diff}>
              {busy.diff ? "Diffing…" : "Run Diff"}
            </button>
            <button type="button" onClick={triggerCIGate} disabled={busy.ci}>
              {busy.ci ? "Checking…" : "Run CI Gate"}
            </button>
          </div>
        </div>
        <div className="drillbar">
          <div className="breadcrumbs">
            {breadcrumb.map((item, index) => (
              <span key={item.id} className="crumb-wrap">
                {index > 0 && <span className="crumb-sep">/</span>}
                <button
                  type="button"
                  className={`crumb ${item.id === currentParentId ? "active" : ""}`}
                  onClick={() => jumpToCrumb(item.id)}
                >
                  {item.name}
                </button>
              </span>
            ))}
          </div>
          <div className="drillbar-meta">
            <strong>Focus L{currentDepth}</strong>
            <span>{viewGraph.nodes.length} modules</span>
            <span>{visibleEdges.length} links</span>
            <span>Drag modules to rearrange · dblclick to expand/collapse</span>
            {moduleById[currentParentId]?.parent_id && (
              <button type="button" onClick={drillUpOneLevel}>Up</button>
            )}
          </div>
        </div>
        <div className={`workspace-body ${(propertiesHidden || focusMode) ? "no-properties" : ""}`}>
          <div className={`diagram-column ${focusMode ? "focus-canvas" : ""}`}>
            {!focusMode && (
            <section className="link-strip">
              <header>
                <h3>Visible Links</h3>
                <span>
                  {visibleEdgeRows.length} links · min x{effectiveEdgeMinCount} · scope {edgeScope === "all" ? "all" : "selected"} · labels {showEdgeLabels ? (denseLabelMode ? "smart" : "on") : "off"}
                </span>
              </header>
              <div className="link-strip-list">
                {visibleEdgeRows.slice(0, 24).map((edge) => (
                  <button
                    key={edge.id}
                    type="button"
                    className={`link-row link-${edge.kind} ${selectedEdgeId === edge.id ? "active" : ""}`}
                    onClick={() => {
                      setSelectedModuleId(edge.src_id);
                      setSelectedEdgeId(edge.id);
                      setActivePortFocus(null);
                    }}
                  >
                    <strong>{edge.srcName}</strong>
                    <span>{humanizeKind(edge.kind)} · {edge.label}</span>
                    <em>{edge.dstName}</em>
                  </button>
                ))}
                {!visibleEdgeRows.length && <p className="empty">No links in current semantic view.</p>}
              </div>
              {activePortFocus && (
                <p className="port-focus-hint">
                  Port Focus: {activePortFocus.direction.toUpperCase()} on {moduleById[activePortFocus.nodeId]?.name || activePortFocus.nodeId}.
                  Highlighting connectable {candidateDirection.toUpperCase()} ports.
                </p>
              )}
              {selectedEdge ? (
                <aside className={`edge-inspector edge-${selectedEdge.kind}`}>
                  <h4>Selected Link</h4>
                  <p>
                    <strong>{selectedEdge.srcName}</strong> → <strong>{selectedEdge.dstName}</strong>
                  </p>
                  <p>{humanizeKind(selectedEdge.kind)} · {selectedEdge.label}</p>
                  {!!selectedEdge.raw_labels?.length && (
                    <ul>
                      {selectedEdge.raw_labels.slice(0, 5).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}
                </aside>
              ) : (
                <p className="edge-inspector-empty">Click a link or line to inspect details.</p>
              )}
            </section>
            )}
            <section className="canvas-wrap" ref={canvasWrapRef} onWheel={handleCanvasWheel}>
              {!model && <p className="empty">No model loaded yet.</p>}
              {model && (
                <>
                  <svg
                    ref={svgRef}
                    className="diagram"
                    width={renderLayout.width}
                    height={renderLayout.height}
                    viewBox={`0 0 ${renderLayout.width} ${renderLayout.height}`}
                    style={{ transform: `scale(${zoom})`, transformOrigin: "0 0" }}
                    onPointerMove={moveNodeDrag}
                    onPointerUp={finishNodeDrag}
                    onPointerCancel={finishNodeDrag}
                    onPointerLeave={() => {
                      setHoverNodeId("");
                      setHoverCard(null);
                    }}
                    onClick={() => {
                      setSelectedEdgeId("");
                      setActivePortFocus(null);
                    }}
                  >
                <defs>
                  <marker
                    id="arrow-dep"
                    markerWidth="5.8"
                    markerHeight="5"
                    refX="5.3"
                    refY="2.5"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <polygon points="0,0 5.8,2.5 0,5" fill="#2c3948" />
                  </marker>
                  <marker
                    id="arrow-intf"
                    markerWidth="6.4"
                    markerHeight="5.6"
                    refX="5.9"
                    refY="2.8"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <polygon points="0,0 6.4,2.8 0,5.6" fill="#2f6fa5" />
                  </marker>
                  <marker
                    id="arrow-file"
                    markerWidth="5.8"
                    markerHeight="5"
                    refX="5.3"
                    refY="2.5"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <polygon points="0,0 5.8,2.5 0,5" fill="#b56f1f" />
                  </marker>
                  <marker
                    id="arrow-other"
                    markerWidth="5.8"
                    markerHeight="5"
                    refX="5.3"
                    refY="2.5"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <polygon points="0,0 5.8,2.5 0,5" fill="#5f6c7b" />
                  </marker>
                </defs>
                  {renderLayout.lanes.map((lane) => (
                    <g key={lane.layer}>
                      <rect x={lane.x} y={lane.y} width={lane.width} height={lane.height} rx="18" className="lane" />
                      <text x={lane.x + 16} y={lane.y + 30} className="lane-title">{lane.layer}</text>
                    </g>
                  ))}
                  {(renderLayout.moduleContainers || []).map((container) => {
                    const focused = container.id === currentParentId;
                    return (
                      <g key={`container-${container.id}`} className={`module-container ${focused ? "focused" : ""}`}>
                        <rect
                          x={container.x}
                          y={container.y}
                          width={container.width}
                          height={container.height}
                          rx="16"
                          className="module-container-body"
                        />
                        <text x={container.x + 12} y={container.y + 18} className="module-container-title">
                          {clipByUnits(moduleById[container.id]?.name || container.name || container.id, 28)}
                        </text>
                        <text x={container.x + 12} y={container.y + 32} className="module-container-meta">
                          L{container.level} · {container.memberCount} nodes
                        </text>
                      </g>
                    );
                  })}
                  {!visibleEdges.length && (
                    <text x={renderLayout.width / 2} y={58} textAnchor="middle" className="no-edge-note">
                      No module links in current semantic view under filter.
                    </text>
                  )}
                  {visibleEdges.map((edge) => {
                const src = drawNodeById[edge.src_id];
                const dst = drawNodeById[edge.dst_id];
                if (!src || !dst) {
                  return null;
                }
                const geometry = edgeGeometryById[edge.id];
                if (!geometry) {
                  return null;
                }
                const selectedByEdge = selectedEdgeId === edge.id;
                const relatedToSelectedModule = selectedIsVisible
                  && (edge.src_id === selectedModuleId || edge.dst_id === selectedModuleId);
                const relatedToHover = hoverContext.edgeIds.has(edge.id);
                const selected = selectedByEdge
                  || (!selectedEdgeId && relatedToSelectedModule)
                  || relatedToHover;
                const showLabel = showEdgeLabels && (!denseLabelMode || selected || selectedByEdge || relatedToHover);
                let dimmed = false;
                if (hoverNodeId) {
                  dimmed = !relatedToHover;
                } else if (selectedEdgeId) {
                  dimmed = edge.id !== selectedEdgeId;
                } else if (selectedIsVisible) {
                  dimmed = !relatedToSelectedModule;
                }
                const edgeKindClass = ["dependency", "interface", "dependency_file"].includes(edge.kind)
                  ? edge.kind
                  : "other";
                const cls = ["edge", `edge-${edgeKindClass}`];
                if (selected) cls.push("selected");
                if (dimmed) cls.push("dimmed");
                const marker = edge.kind === "interface"
                  ? "url(#arrow-intf)"
                  : edge.kind === "dependency_file"
                    ? "url(#arrow-file)"
                    : edge.kind === "dependency"
                      ? "url(#arrow-dep)"
                      : "url(#arrow-other)";
                const baseWidth = edge.kind === "interface" ? 2.3 : edge.kind === "dependency_file" ? 2 : 2.1;
                const weightWidth = Math.min(1.8, edge.count * 0.22);
                const dashArray = edge.kind === "dependency_file"
                  ? "9 5"
                  : edge.kind === "other"
                    ? "3 5"
                    : undefined;
                const backgroundEdge = dimmed && selectedIsVisible && !selectedEdgeId && !hoverNodeId;
                const normalStrokeWidth = selectedByEdge
                  ? baseWidth + 2.3
                  : selected
                    ? baseWidth + 1.4
                    : baseWidth + weightWidth;
                const strokeWidth = backgroundEdge
                  ? Math.max(0.9, normalStrokeWidth * 0.58)
                  : normalStrokeWidth;
                const showDecorations = !backgroundEdge || selectedByEdge || relatedToHover;
                const sourceTerminalX = geometry.sourceSide === "right" ? geometry.startX + 1 : geometry.startX - 9;
                const targetTerminalX = geometry.targetSide === "right" ? geometry.endX + 1 : geometry.endX - 9;
                const sourceTerminalY = geometry.startY - 4;
                const targetTerminalY = geometry.endY - 4;
                    return (
                      <g
                        key={edge.id}
                        className="edge-group"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedEdgeId(edge.id);
                          setSelectedModuleId(edge.src_id);
                          setActivePortFocus(null);
                        }}
                      >
                    <path
                      d={geometry.path}
                      className="edge-hitbox"
                    />
                    {edge.kind === "interface" && showDecorations && (
                      <path
                        d={geometry.path}
                        className={`edge edge-interface-shell ${selected ? "selected" : ""} ${dimmed ? "dimmed" : ""}`}
                        style={{ strokeWidth: selectedByEdge ? 8 : selected ? 7 : 6.4 }}
                      />
                    )}
                    <path
                      d={geometry.path}
                      className={cls.join(" ")}
                      markerEnd={backgroundEdge ? undefined : marker}
                      style={{
                        strokeDasharray: dashArray,
                        strokeWidth,
                      }}
                    />
                    {edge.kind === "interface" ? (
                      <>
                        {showDecorations && (
                          <>
                            <g className={`edge-terminal interface ${selected ? "selected" : ""} ${dimmed ? "dimmed" : ""}`}>
                              <rect x={sourceTerminalX} y={sourceTerminalY} width="8" height="8" rx="1.4" className="terminal-body" />
                              <line x1={sourceTerminalX + 2} y1={sourceTerminalY + 1.3} x2={sourceTerminalX + 2} y2={sourceTerminalY + 6.7} className="terminal-bar" />
                              <line x1={sourceTerminalX + 4} y1={sourceTerminalY + 1.3} x2={sourceTerminalX + 4} y2={sourceTerminalY + 6.7} className="terminal-bar" />
                              <line x1={sourceTerminalX + 6} y1={sourceTerminalY + 1.3} x2={sourceTerminalX + 6} y2={sourceTerminalY + 6.7} className="terminal-bar" />
                            </g>
                            <g className={`edge-terminal interface ${selected ? "selected" : ""} ${dimmed ? "dimmed" : ""}`}>
                              <rect x={targetTerminalX} y={targetTerminalY} width="8" height="8" rx="1.4" className="terminal-body" />
                              <line x1={targetTerminalX + 2} y1={targetTerminalY + 1.3} x2={targetTerminalX + 2} y2={targetTerminalY + 6.7} className="terminal-bar" />
                              <line x1={targetTerminalX + 4} y1={targetTerminalY + 1.3} x2={targetTerminalX + 4} y2={targetTerminalY + 6.7} className="terminal-bar" />
                              <line x1={targetTerminalX + 6} y1={targetTerminalY + 1.3} x2={targetTerminalX + 6} y2={targetTerminalY + 6.7} className="terminal-bar" />
                            </g>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        {showDecorations && (
                          <>
                            <circle
                              cx={geometry.startX}
                              cy={geometry.startY}
                              r={selectedByEdge ? 3.8 : 3}
                              className={`edge-endpoint edge-endpoint-${edgeKindClass} ${selected ? "selected" : ""}`}
                            />
                            <circle
                              cx={geometry.endX}
                              cy={geometry.endY}
                              r={selectedByEdge ? 3.8 : 3}
                              className={`edge-endpoint edge-endpoint-${edgeKindClass} ${selected ? "selected" : ""}`}
                            />
                          </>
                        )}
                      </>
                    )}
                    {showLabel && (
                      <text
                        className={`edge-label ${selected ? "selected" : ""} ${denseLabelMode ? "compact" : ""}`}
                        x={geometry.labelX}
                        y={geometry.labelY}
                      >
                        {clip(edge.label, denseLabelMode ? 22 : 34)}
                      </text>
                    )}
                  </g>
                );
              })}
                  {renderLayout.nodes.map((node) => {
                  const isActive = node.id === selectedModuleId;
                  const canExpand = hasChildren(node.id);
                  const isExpanded = expandedModuleIds.has(node.id);
                  const isFocused = node.id === currentParentId;
                  const contextKind = node.contextKind || "context";
                  const outerInCount = Number(node.outerInParentCount || 0);
                  const outerOutCount = Number(node.outerOutParentCount || 0);
                  const inBadgeLabel = outerInCount > 0 ? `IN +${outerInCount}P` : "";
                  const outBadgeLabel = outerOutCount > 0 ? `OUT +${outerOutCount}P` : "";
                  const inBadgeWidth = Math.max(58, inBadgeLabel.length * 6.1 + 14);
                  const outBadgeWidth = Math.max(62, outBadgeLabel.length * 6.1 + 14);
                  const badgeY = node.y + node.height - 23;
                  const isHoveredNode = hoverNodeId === node.id;
                  const isNeighborNode = hoverContext.neighborIds.has(node.id);
                  const dimmedByHover = hoverNodeId && !isHoveredNode && !isNeighborNode;
                  const nodeClasses = [
                    "node",
                    isActive ? "active" : "",
                    isFocused ? "focused" : "",
                    canExpand ? "expandable" : "leaf",
                    isExpanded ? "expanded" : "collapsed",
                    `context-${contextKind}`,
                    draggingNodeId === node.id ? "dragging" : "",
                    isHoveredNode ? "hovered" : "",
                    isNeighborNode ? "neighbor" : "",
                    dimmedByHover ? "dimmed" : "",
                  ].filter(Boolean).join(" ");
                    return (
                      <g
                        key={node.id}
                        className={nodeClasses}
                        onClick={() => activateNode(node.id)}
                        onDoubleClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleModuleExpand(node.id);
                        }}
                        onPointerDown={(event) => startNodeDrag(event, node)}
                        onPointerEnter={(event) => showNodeHover(event, node.id)}
                        onPointerMove={(event) => moveNodeHover(event, node.id)}
                        onPointerLeave={() => hideNodeHover(node.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            activateNode(node.id);
                          } else if ((event.key === "ArrowRight" || event.key === "+") && canExpand) {
                            event.preventDefault();
                            toggleModuleExpand(node.id);
                          }
                        }}
                      >
                      <rect x={node.x} y={node.y} width={node.width} height={node.height} rx="14" className="node-body" />
                      <rect x={node.x + 1} y={node.y + 1} width={node.width - 2} height="30" rx="12" className="node-header" />
                      <text x={node.x + 14} y={node.y + 26} className="title">{clipByUnits(node.name, node.portTextUnits + 1)}</text>
                      <text x={node.x + 14} y={node.y + 46} className="meta">Layer: {node.layer} · L{node.level}</text>
                      {node.summaryLines.map((line, idx) => (
                        <text key={`summary-${node.id}-${line}-${idx}`} x={node.x + 14} y={node.y + node.summaryY + idx * 14} className="summary-line">
                          {line}
                        </text>
                      ))}
                      {!!node.summaryLines.length && (
                        <text
                          x={node.x + node.width - 14}
                          y={node.y + node.summaryY}
                          textAnchor="end"
                          className={`summary-tag ${node.summarySource === "llm" ? "llm" : "fallback"}`}
                        >
                          {node.summarySource === "llm" ? "LLM" : "Fallback"}
                        </text>
                      )}
                      {node.displayInPorts.map((port, idx) => {
                        const visualState = getPortVisualState(node.id, port, "in");
                        const isBus = isInterfaceProtocol(port.protocol);
                        const portY = node.portStartY + idx * 16 - 4;
                        return (
                          <g
                            key={`${port.id}-in`}
                            onClick={(event) => {
                              event.stopPropagation();
                              const portId = port.id || `in-${port.name}-${port.protocol}`;
                              setActivePortFocus((old) => (
                                old && old.nodeId === node.id && old.portId === portId
                                  ? null
                                  : { nodeId: node.id, portId, direction: "in" }
                              ));
                            }}
                          >
                            <line
                              x1={node.x - 10}
                              y1={portY}
                              x2={node.x}
                              y2={portY}
                              className={`pin-line in ${isBus ? "bus" : ""} ${visualState}`}
                            />
                            <rect
                              x={node.x - 5}
                              y={portY - 3}
                              width="6"
                              height="6"
                              className={`pin-dot in ${isBus ? "bus" : ""} ${visualState}`}
                            />
                            {isBus && (
                              <>
                                <line x1={node.x - 10} y1={portY - 2} x2={node.x - 7} y2={portY - 2} className={`pin-bus-mark ${visualState}`} />
                                <line x1={node.x - 10} y1={portY + 2} x2={node.x - 7} y2={portY + 2} className={`pin-bus-mark ${visualState}`} />
                              </>
                            )}
                            <text
                              x={node.x + 14}
                              y={node.portStartY + idx * 16}
                              className={`port in-port ${isBus ? "bus" : ""} ${visualState}`}
                            >
                              IN {clipByUnits(formatPortText(port), node.portTextUnits)}
                            </text>
                          </g>
                        );
                      })}
                      {node.inOverflow > 0 && (
                        <text
                          x={node.x + 14}
                          y={node.portStartY + node.displayInPorts.length * 16}
                          className="port in-port more-port"
                        >
                          +{node.inOverflow} more
                        </text>
                      )}
                      {node.displayOutPorts.map((port, idx) => {
                        const visualState = getPortVisualState(node.id, port, "out");
                        const isBus = isInterfaceProtocol(port.protocol);
                        const portY = node.portStartY + idx * 16 - 4;
                        return (
                          <g
                            key={`${port.id}-out`}
                            onClick={(event) => {
                              event.stopPropagation();
                              const portId = port.id || `out-${port.name}-${port.protocol}`;
                              setActivePortFocus((old) => (
                                old && old.nodeId === node.id && old.portId === portId
                                  ? null
                                  : { nodeId: node.id, portId, direction: "out" }
                              ));
                            }}
                          >
                            <line
                              x1={node.x + node.width}
                              y1={portY}
                              x2={node.x + node.width + 10}
                              y2={portY}
                              className={`pin-line out ${isBus ? "bus" : ""} ${visualState}`}
                            />
                            <rect
                              x={node.x + node.width - 1}
                              y={portY - 3}
                              width="6"
                              height="6"
                              className={`pin-dot out ${isBus ? "bus" : ""} ${visualState}`}
                            />
                            {isBus && (
                              <>
                                <line x1={node.x + node.width + 7} y1={portY - 2} x2={node.x + node.width + 10} y2={portY - 2} className={`pin-bus-mark ${visualState}`} />
                                <line x1={node.x + node.width + 7} y1={portY + 2} x2={node.x + node.width + 10} y2={portY + 2} className={`pin-bus-mark ${visualState}`} />
                              </>
                            )}
                            <text
                              x={node.x + node.width - 14}
                              y={node.portStartY + idx * 16}
                              textAnchor="end"
                              className={`port out-port ${isBus ? "bus" : ""} ${visualState}`}
                            >
                              OUT {clipByUnits(formatPortText(port), node.portTextUnits)}
                            </text>
                          </g>
                        );
                      })}
                      {node.outOverflow > 0 && (
                        <text
                          x={node.x + node.width - 14}
                          y={node.portStartY + node.displayOutPorts.length * 16}
                          textAnchor="end"
                          className="port out-port more-port"
                        >
                          +{node.outOverflow} more
                        </text>
                      )}
                      {canExpand && (
                        <g
                          className={`node-expand-toggle ${isExpanded ? "expanded" : "collapsed"}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleModuleExpand(node.id);
                          }}
                        >
                          <rect
                            x={node.x + node.width - 36}
                            y={node.y + 8}
                            width="24"
                            height="14"
                            rx="7"
                            className="expand-toggle-bg"
                          />
                          <text
                            x={node.x + node.width - 24}
                            y={node.y + 18}
                            textAnchor="middle"
                            className="expand-toggle-text"
                          >
                            {isExpanded ? "-" : "+"}
                          </text>
                        </g>
                      )}
                      {outerInCount > 0 && (
                        <g
                          className="node-agg-badge in"
                          onClick={(event) => {
                            event.stopPropagation();
                            expandOuterDirection(node.id, "in");
                          }}
                        >
                          <rect
                            x={node.x + 10}
                            y={badgeY}
                            width={inBadgeWidth}
                            height="15"
                            rx="7"
                            className="agg-bg"
                          />
                          <text
                            x={node.x + 10 + inBadgeWidth / 2}
                            y={badgeY + 11}
                            textAnchor="middle"
                            className="agg-text"
                          >
                            {inBadgeLabel}
                          </text>
                        </g>
                      )}
                      {outerOutCount > 0 && (
                        <g
                          className="node-agg-badge out"
                          onClick={(event) => {
                            event.stopPropagation();
                            expandOuterDirection(node.id, "out");
                          }}
                        >
                          <rect
                            x={node.x + node.width - outBadgeWidth - 10}
                            y={badgeY}
                            width={outBadgeWidth}
                            height="15"
                            rx="7"
                            className="agg-bg"
                          />
                          <text
                            x={node.x + node.width - 10 - outBadgeWidth / 2}
                            y={badgeY + 11}
                            textAnchor="middle"
                            className="agg-text"
                          >
                            {outBadgeLabel}
                          </text>
                        </g>
                      )}
                      {canExpand && (
                        <text
                          x={node.x + node.width - 12}
                          y={node.y + node.height - 12}
                          textAnchor="end"
                          className="drill-hint"
                        >
                          dblclick to zoom
                        </text>
                      )}
                      </g>
                    );
                  })}
                  </svg>
                  {hoverCard && (
                    <aside className="node-hover-card" style={{ left: hoverCard.x, top: hoverCard.y }}>
                      <h4>{moduleById[hoverCard.nodeId]?.name || hoverCard.nodeId}</h4>
                      <p>{llmSummaries[hoverCard.nodeId] || ""}</p>
                      <span className={`source-pill ${llmSummarySource[hoverCard.nodeId] === "llm" ? "llm" : "fallback"}`}>
                        {llmSummarySource[hoverCard.nodeId] === "llm" ? "Local LLM" : "Fallback"}
                      </span>
                    </aside>
                  )}
                </>
              )}
            </section>
          </div>
          {!propertiesHidden && !focusMode && (
          <aside className="properties-panel">
            <header>
              <h3>Properties</h3>
              {selectedModule && <span>{selectedModule.layer} · L{selectedModule.level}</span>}
            </header>
            {!selectedModule ? (
              <p className="empty">Select a module to inspect and edit properties.</p>
            ) : (
              <>
                <section className="prop-group">
                  <h4>General</h4>
                  <label>
                    Name
                    <input
                      value={selectedModule.name}
                      onChange={(event) => patchSelectedModuleEdit({ name: event.target.value })}
                    />
                  </label>
                  <label>
                    Path
                    <input value={selectedModule.path || "/"} readOnly />
                  </label>
                  <label>
                    Summary
                    <textarea
                      value={typeof selectedModuleEdit.summary === "string" ? selectedModuleEdit.summary : selectedModuleSummary}
                      onChange={(event) => patchSelectedModuleEdit({ summary: event.target.value })}
                      rows={4}
                    />
                  </label>
                </section>
                <section className="prop-group">
                  <h4>Ports</h4>
                  <ul className="prop-port-list">
                    {selectedModulePorts.slice(0, 24).map((port) => (
                      <li key={port.id}>
                        <strong>{String(port.direction).toUpperCase()}</strong> {port.protocol} {port.name}
                      </li>
                    ))}
                    {!selectedModulePorts.length && <li>None</li>}
                  </ul>
                </section>
                <section className="prop-group">
                  <h4>Params</h4>
                  <div className="param-grid">
                    {selectedParams.map((item, index) => (
                      <div key={`param-${index}-${item.key}`} className="param-row">
                        <input
                          value={item.key || ""}
                          placeholder="key"
                          onChange={(event) => upsertParam(index, "key", event.target.value)}
                        />
                        <input
                          value={item.value || ""}
                          placeholder="value"
                          onChange={(event) => upsertParam(index, "value", event.target.value)}
                        />
                        <button type="button" onClick={() => removeParamRow(index)}>×</button>
                      </div>
                    ))}
                    {!selectedParams.length && <p className="empty">No params yet.</p>}
                  </div>
                  <div className="prop-actions">
                    <button type="button" onClick={addParamRow}>Add Param</button>
                    <button type="button" onClick={resetSelectedModuleOverrides}>Reset Module</button>
                  </div>
                </section>
              </>
            )}
          </aside>
          )}
        </div>
        {!dockHidden && !focusMode && (
        <section className="dock-panel">
          <div className="dock-tabs">
            <button type="button" className={dockTab === "console" ? "active" : ""} onClick={() => setDockTab("console")}>
              Console
            </button>
            <button type="button" className={dockTab === "messages" ? "active" : ""} onClick={() => setDockTab("messages")}>
              Messages
              <span className="badge-bundle">
                <b className="badge info">{messageCounts.info}</b>
                <b className="badge warning">{messageCounts.warning}</b>
                <b className="badge error">{messageCounts.error}</b>
              </span>
            </button>
            <button type="button" className={dockTab === "log" ? "active" : ""} onClick={() => setDockTab("log")}>
              Log <span className="badge plain">{logs.length}</span>
            </button>
          </div>
          <div className="dock-content">
            {dockTab === "console" && (
              <div className="console-tab">
                <p className="console-hint">Built-in: `help`, `reload`, `zoomfit`, `export`, `diff`</p>
                <p className="console-meta">
                  Last Diff: {diffReport ? `${diffReport.violations?.length || 0} violation(s)` : "n/a"} ·
                  Last CI: {ciResult ? (ciResult.ok ? "PASS" : "FAIL") : "n/a"}
                </p>
                <input
                  className="console-input"
                  value={consoleInput}
                  placeholder="Enter command..."
                  onChange={(event) => setConsoleInput(event.target.value)}
                  onKeyDown={handleConsoleKeyDown}
                />
              </div>
            )}
            {dockTab === "messages" && (
              <div className="messages-tab">
                <div className="severity-filters">
                  {["info", "warning", "error"].map((severity) => (
                    <button
                      key={severity}
                      type="button"
                      className={`${messageFilters[severity] !== false ? "active" : ""} severity-${severity}`}
                      onClick={() => setMessageFilters((old) => ({ ...old, [severity]: !(old[severity] ?? true) }))}
                    >
                      {severity.toUpperCase()} <span>{messageCounts[severity]}</span>
                    </button>
                  ))}
                </div>
                <div className="messages-list">
                  {filteredMessages.map((item) => (
                    <article key={item.id} className={`message-row severity-${item.severity}`}>
                      <strong>[{item.severity.toUpperCase()}]</strong>
                      <span>{item.text}</span>
                      <em>{item.time}</em>
                    </article>
                  ))}
                  {!filteredMessages.length && <p className="empty">No messages under current filter.</p>}
                </div>
              </div>
            )}
            {dockTab === "log" && (
              <div className="log-tab">
                <div className="log-actions">
                  <button type="button" onClick={() => setLogs([])}>Clear</button>
                </div>
                <div className="log-list">
                  {logs.map((item) => (
                    <p key={item.id} className={`log-line severity-${item.severity}`}>
                      <strong>{item.time}</strong> {item.text}
                    </p>
                  ))}
                  {!logs.length && <p className="empty">No logs yet.</p>}
                </div>
              </div>
            )}
          </div>
        </section>
        )}
        {error && <div className="error-banner">{error}</div>}
      </main>
    </div>
  );
}
export default App;
