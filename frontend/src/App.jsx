import { useEffect, useMemo, useRef, useState } from "react";

import { buildArchitecture, diffArchitecture, fetchModel, healthCheck, runCIGate } from "./api";
import "./App.css";

function clip(text, maxLength) {
  if (!text) {
    return "";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
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

function representativeUnderParent(moduleId, parentId, moduleById, visibleIds) {
  let current = moduleById[moduleId];
  while (current) {
    if (current.parent_id === parentId && visibleIds.has(current.id)) {
      return current;
    }
    if (!current.parent_id) {
      return null;
    }
    current = moduleById[current.parent_id] || null;
  }
  return null;
}

function collectViewGraph(model, currentParentId, childrenByParent, moduleById) {
  if (!model || !currentParentId) {
    return { nodes: [], edges: [] };
  }

  const nodes = [...(childrenByParent[currentParentId] || [])];
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
      raw_labels: Array.from(rawEdge.labels || []).filter(Boolean).sort(),
      id: rawEdge.id,
      src_id: rawEdge.src_id,
      dst_id: rawEdge.dst_id,
      kind: rawEdge.kind,
      label: formatEdgeLabel(rawEdge),
      count: rawEdge.count,
    }))
    .sort((a, b) => `${a.kind}:${a.src_id}:${a.dst_id}`.localeCompare(`${b.kind}:${b.src_id}:${b.dst_id}`));

  return {
    nodes,
    edges,
  };
}

function layoutGraph(nodes, portsByModule, summaryByModule = {}, summarySourceByModule = {}) {
  const groups = new Map();
  for (const node of nodes) {
    if (!groups.has(node.layer)) {
      groups.set(node.layer, []);
    }
    groups.get(node.layer).push(node);
  }

  const layers = Array.from(groups.keys());
  const nodeWidth = 300;
  const laneWidth = 370;
  const laneGap = 96;
  const top = 84;
  const left = 76;
  const laneHeader = 46;
  const lanePadding = 28;

  const drawNodes = [];
  const lanes = [];
  let maxHeight = 500;

  for (let col = 0; col < layers.length; col += 1) {
    const layer = layers[col];
    const laneX = left + col * (laneWidth + laneGap);
    let cursorY = top + laneHeader + lanePadding;

    const sorted = [...groups.get(layer)].sort((a, b) => a.name.localeCompare(b.name));
    for (const node of sorted) {
      const ports = portsByModule[node.id] || [];
      const inPorts = ports.filter((item) => String(item.direction).toLowerCase() === "in");
      const outPorts = ports.filter((item) => String(item.direction).toLowerCase() === "out");
      const summary = (summaryByModule[node.id] || "").trim();
      const summarySource = summary ? (summarySourceByModule[node.id] || "fallback") : "";
      const portRows = Math.max(Math.min(inPorts.length, 3), Math.min(outPorts.length, 3), 1);
      const summaryRows = summary ? 1 : 0;
      const height = 108 + summaryRows * 24 + portRows * 18;
      const portStartY = summary ? cursorY + 94 : cursorY + 70;

      drawNodes.push({
        ...node,
        x: laneX + (laneWidth - nodeWidth) / 2,
        y: cursorY,
        width: nodeWidth,
        height,
        inPorts,
        outPorts,
        summary,
        summarySource,
        portStartY,
      });

      cursorY += height + 36;
    }

    const laneHeight = Math.max(430, cursorY - top + lanePadding);
    lanes.push({
      layer,
      x: laneX,
      y: top,
      width: laneWidth,
      height: laneHeight,
    });
    maxHeight = Math.max(maxHeight, laneHeight + 110);
  }

  const width = left + Math.max(1, layers.length) * laneWidth + Math.max(0, layers.length - 1) * laneGap + 130;
  return {
    width,
    height: maxHeight,
    lanes,
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

  const maxX = Math.max(...nodes.map((node) => node.x + node.width), layout.width - 120);
  const maxY = Math.max(...nodes.map((node) => node.y + node.height), layout.height - 120);

  return {
    ...layout,
    nodes,
    lanes,
    width: Math.max(layout.width, maxX + 140),
    height: Math.max(layout.height, maxY + 140),
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

  const slotSort = (edgeIdA, edgeIdB) => {
    const edgeA = recordByEdgeId[edgeIdA]?.edge;
    const edgeB = recordByEdgeId[edgeIdB]?.edge;
    const keyA = `${edgeA?.dst_id || ""}|${edgeA?.kind || ""}|${edgeA?.id || ""}`;
    const keyB = `${edgeB?.dst_id || ""}|${edgeB?.kind || ""}|${edgeB?.id || ""}`;
    return keyA.localeCompare(keyB);
  };

  const outgoingByEdgeId = {};
  const incomingByEdgeId = {};

  for (const edgeIds of outgoing.values()) {
    edgeIds.sort(slotSort);
    edgeIds.forEach((edgeId, index) => {
      outgoingByEdgeId[edgeId] = { index, count: edgeIds.length };
    });
  }

  for (const edgeIds of incoming.values()) {
    edgeIds.sort(slotSort);
    edgeIds.forEach((edgeId, index) => {
      incomingByEdgeId[edgeId] = { index, count: edgeIds.length };
    });
  }

  const topMost = Math.min(...records.map((item) => Math.min(item.source.y, item.target.y)));
  const topTrack = Math.max(40, topMost - 56);
  const trackSpacing = 14;

  const output = {};
  records.forEach((item, trackIndex) => {
    const edgeId = item.edge.id;
    const outMeta = outgoingByEdgeId[edgeId] || { index: 0, count: 1 };
    const inMeta = incomingByEdgeId[edgeId] || { index: 0, count: 1 };

    const startX = item.leftToRight ? item.source.x + item.source.width - 8 : item.source.x + 8;
    const endX = item.leftToRight ? item.target.x + 8 : item.target.x + item.target.width - 8;

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

    let sourceGateX = item.leftToRight
      ? startX + 22 + outMeta.index * 9
      : startX - 22 - outMeta.index * 9;

    let targetGateX = item.leftToRight
      ? endX - 22 - inMeta.index * 9
      : endX + 22 + inMeta.index * 9;

    const minGap = 18;
    if (item.leftToRight && sourceGateX > targetGateX - minGap) {
      const center = (startX + endX) / 2;
      sourceGateX = Math.min(sourceGateX, center - minGap / 2);
      targetGateX = Math.max(targetGateX, center + minGap / 2);
    }
    if (!item.leftToRight && sourceGateX < targetGateX + minGap) {
      const center = (startX + endX) / 2;
      sourceGateX = Math.max(sourceGateX, center + minGap / 2);
      targetGateX = Math.min(targetGateX, center - minGap / 2);
    }

    const trackY = topTrack + trackIndex * trackSpacing;
    output[edgeId] = {
      path: [
        `M ${startX} ${startY}`,
        `L ${sourceGateX} ${startY}`,
        `L ${sourceGateX} ${trackY}`,
        `L ${targetGateX} ${trackY}`,
        `L ${targetGateX} ${endY}`,
        `L ${endX} ${endY}`,
      ].join(" "),
      labelX: (sourceGateX + targetGateX) / 2,
      labelY: trackY - 5,
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
  const [selectedModuleId, setSelectedModuleId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [zoom, setZoom] = useState(1);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [selectedEdgeId, setSelectedEdgeId] = useState("");

  const [edgeFilters, setEdgeFilters] = useState({});

  const [busy, setBusy] = useState({ build: false, diff: false, ci: false, refresh: false });

  const [diffInput, setDiffInput] = useState({ base: "main", head: "HEAD" });
  const [diffReport, setDiffReport] = useState(null);
  const [ciResult, setCiResult] = useState(null);
  const [manualLayouts, setManualLayouts] = useState({});
  const [draggingNodeId, setDraggingNodeId] = useState("");
  const [hoverCard, setHoverCard] = useState(null);

  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);

  const layoutScope = model?.metadata?.snapshot_id || model?.commit_id || "default";

  const moduleById = useMemo(() => buildModuleLookup(model?.modules || []), [model]);
  const childrenByParent = useMemo(() => buildChildrenLookup(model?.modules || []), [model]);
  const descendantsByModule = useMemo(() => buildDescendantsLookup(model?.modules || []), [model]);
  const evidenceById = useMemo(() => buildEvidenceLookup(snapshot?.evidences || []), [snapshot]);

  const systemModule = useMemo(() => {
    const modules = model?.modules || [];
    const explicit = modules.find((item) => item.level === 0 && !item.parent_id);
    if (explicit) {
      return explicit;
    }
    const sorted = [...modules].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
    return sorted[0] || null;
  }, [model]);

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
  const llmSummaries = useMemo(() => model?.metadata?.llm_summaries || {}, [model]);
  const llmSummarySource = useMemo(() => model?.metadata?.llm_summary_source || {}, [model]);

  const viewGraph = useMemo(
    () => collectViewGraph(model, currentParentId, childrenByParent, moduleById),
    [model, currentParentId, childrenByParent, moduleById],
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
      const raw = window.localStorage.getItem(`archsync.manualLayouts.${layoutScope}`);
      if (!raw) {
        setManualLayouts({});
        return;
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        setManualLayouts(parsed);
        return;
      }
      setManualLayouts({});
    } catch {
      setManualLayouts({});
    }
  }, [layoutScope]);

  useEffect(() => {
    try {
      window.localStorage.setItem(`archsync.manualLayouts.${layoutScope}`, JSON.stringify(manualLayouts));
    } catch {
      // ignore storage errors
    }
  }, [layoutScope, manualLayouts]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("archsync.sidebarHidden");
      setSidebarHidden(raw === "1");
    } catch {
      setSidebarHidden(false);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("archsync.sidebarHidden", sidebarHidden ? "1" : "0");
    } catch {
      // ignore storage errors
    }
  }, [sidebarHidden]);

  const visibleEdges = useMemo(
    () => viewGraph.edges.filter((edge) => edgeFilters[edge.kind] !== false),
    [viewGraph.edges, edgeFilters],
  );

  const autoLayout = useMemo(
    () => layoutGraph(viewGraph.nodes, portsByModule, llmSummaries, llmSummarySource),
    [viewGraph.nodes, portsByModule, llmSummaries, llmSummarySource],
  );

  const manualPositionsForCurrent = useMemo(
    () => (currentParentId ? manualLayouts[currentParentId] || {} : {}),
    [manualLayouts, currentParentId],
  );

  const layout = useMemo(
    () => applyManualLayout(autoLayout, manualPositionsForCurrent),
    [autoLayout, manualPositionsForCurrent],
  );

  const drawNodeById = useMemo(
    () => Object.fromEntries(layout.nodes.map((item) => [item.id, item])),
    [layout.nodes],
  );

  const edgeGeometryById = useMemo(
    () => buildEdgeGeometries(visibleEdges, drawNodeById),
    [visibleEdges, drawNodeById],
  );

  const availableLevels = useMemo(() => {
    return Array.from(
      new Set((model?.modules || []).filter((item) => item.level > 0).map((item) => item.level)),
    ).sort((a, b) => a - b);
  }, [model]);

  const filteredModules = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return (model?.modules || [])
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
  }, [model, searchQuery, levelFilter]);

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

  const selectedIsVisible = useMemo(
    () => !!selectedModuleId && viewGraph.nodes.some((item) => item.id === selectedModuleId),
    [selectedModuleId, viewGraph.nodes],
  );

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

  useEffect(() => {
    if (!selectedEdgeId) {
      return;
    }
    if (!visibleEdges.some((item) => item.id === selectedEdgeId)) {
      setSelectedEdgeId("");
    }
  }, [visibleEdges, selectedEdgeId]);

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
    setManualLayouts({});
  }

  function showNodeHover(event, nodeId) {
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
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return null;
    }
    const viewBox = svg.viewBox.baseVal;
    return {
      x: ((clientX - rect.left) / rect.width) * viewBox.width + viewBox.x,
      y: ((clientY - rect.top) / rect.height) * viewBox.height + viewBox.y,
    };
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
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDraggingNodeId(node.id);
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
    const maxX = Math.max(minX, layout.width - drag.width - 16);
    const maxY = Math.max(minY, layout.height - drag.height - 16);

    const nextX = Math.min(maxX, Math.max(minX, snapToGrid(point.x - drag.offsetX)));
    const nextY = Math.min(maxY, Math.max(minY, snapToGrid(point.y - drag.offsetY)));

    const currentNode = drawNodeById[drag.nodeId];
    if (!currentNode) {
      return;
    }
    if (Math.abs(currentNode.x - nextX) > 1 || Math.abs(currentNode.y - nextY) > 1) {
      drag.moved = true;
      setNodeManualPosition(drag.nodeId, nextX, nextY);
    }
  }

  function finishNodeDrag(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    if (drag.moved) {
      suppressClickRef.current = true;
    }
    dragRef.current = null;
    setDraggingNodeId("");
  }

  function activateNode(moduleId) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setSelectedEdgeId("");
    drillInto(moduleId);
  }

  function hasChildren(moduleId) {
    return (childrenByParent[moduleId] || []).length > 0;
  }

  function firstChild(moduleId) {
    return (childrenByParent[moduleId] || [])[0] || null;
  }

  async function refreshModel(autoBuild = true) {
    setBusy((old) => ({ ...old, refresh: true }));
    setError("");
    try {
      const response = await fetchModel({ autoBuild });
      setModel(response.model);
      setSnapshot(response.snapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      await refreshModel(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy((old) => ({ ...old, ci: false }));
    }
  }

  function drillInto(moduleId) {
    const module = moduleById[moduleId];
    if (!module) {
      return;
    }

    if (hasChildren(moduleId)) {
      setCurrentParentId(moduleId);
      const child = firstChild(moduleId);
      setSelectedModuleId(child?.id || moduleId);
      return;
    }

    setSelectedModuleId(moduleId);
  }

  function focusModule(moduleId) {
    const module = moduleById[moduleId];
    if (!module) {
      return;
    }
    setSelectedEdgeId("");

    if (hasChildren(moduleId)) {
      setCurrentParentId(moduleId);
      const child = firstChild(moduleId);
      setSelectedModuleId(child?.id || moduleId);
      return;
    }

    setCurrentParentId(module.parent_id || systemModule?.id || "");
    setSelectedModuleId(module.id);
  }

  function drillUpOneLevel() {
    const currentParent = moduleById[currentParentId];
    if (!currentParent || !currentParent.parent_id) {
      return;
    }
    setSelectedModuleId(currentParent.id);
    setCurrentParentId(currentParent.parent_id);
  }

  function jumpToCrumb(moduleId) {
    if (!moduleById[moduleId]) {
      return;
    }
    setSelectedEdgeId("");
    setCurrentParentId(moduleId);
    setSelectedModuleId(moduleId);
  }

  function toggleEdgeKind(kind) {
    setEdgeFilters((old) => ({ ...old, [kind]: !(old[kind] ?? true) }));
  }

  useEffect(() => {
    async function bootstrap() {
      try {
        await healthCheck();
        setServiceStatus("online");
      } catch {
        setServiceStatus("offline");
      }
      await refreshModel(true);
    }

    bootstrap();
  }, []);

  useEffect(() => {
    if (!systemModule) {
      return;
    }

    setCurrentParentId((old) => {
      if (old && moduleById[old]) {
        return old;
      }
      return systemModule.id;
    });

    setSelectedModuleId((old) => {
      if (old && moduleById[old]) {
        return old;
      }
      return "";
    });
  }, [systemModule, moduleById]);

  useEffect(() => {
    setZoom(1);
    setSelectedEdgeId("");
    dragRef.current = null;
    setDraggingNodeId("");
    setHoverCard(null);
  }, [currentParentId]);

  function handleCanvasWheel(event) {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.08 : 0.92;
    setZoom((value) => clampZoom(value * factor));
  }

  return (
    <div className={`studio ${sidebarHidden ? "sidebar-hidden" : ""}`}>
      {!sidebarHidden && (
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
            <button type="button" onClick={() => setSidebarHidden((value) => !value)}>
              {sidebarHidden ? "Show Sidebar" : "Hide Sidebar"}
            </button>
            <button type="button" onClick={() => setZoom((value) => clampZoom(value - 0.1))}>-</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoom((value) => clampZoom(value + 0.1))}>+</button>
            <span className="zoom-hint">Ctrl+Wheel Zoom</span>
            <button type="button" onClick={resetCurrentLayout}>Auto Layout</button>
            <button type="button" onClick={resetAllLayouts}>Reset All</button>
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
            <strong>Depth {currentDepth}</strong>
            <span>{viewGraph.nodes.length} modules</span>
            <span>{visibleEdges.length} links</span>
            <span>Drag modules to rearrange</span>
            {moduleById[currentParentId]?.parent_id && (
              <button type="button" onClick={drillUpOneLevel}>Up</button>
            )}
          </div>
        </div>

        <section className="link-strip">
          <header>
            <h3>Visible Links</h3>
            <span>{visibleEdgeRows.length} links</span>
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
                }}
              >
                <strong>{edge.srcName}</strong>
                <span>{humanizeKind(edge.kind)} · {edge.label}</span>
                <em>{edge.dstName}</em>
              </button>
            ))}
            {!visibleEdgeRows.length && <p className="empty">No links at current depth.</p>}
          </div>
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

        <section className="canvas-wrap" onWheel={handleCanvasWheel}>
          {!model && <p className="empty">No model loaded yet.</p>}
          {model && (
            <>
              <svg
                ref={svgRef}
                className="diagram"
                width={layout.width}
                height={layout.height}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                style={{ transform: `scale(${zoom})`, transformOrigin: "0 0" }}
                onPointerMove={moveNodeDrag}
                onPointerUp={finishNodeDrag}
                onPointerCancel={finishNodeDrag}
              >
                <defs>
                  <marker id="arrow-dep" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
                    <polygon points="0,0 9,3.5 0,7" fill="#25415d" />
                  </marker>
                  <marker id="arrow-intf" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
                    <polygon points="0,0 9,3.5 0,7" fill="#158f73" />
                  </marker>
                  <marker id="arrow-file" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
                    <polygon points="0,0 9,3.5 0,7" fill="#b56f1f" />
                  </marker>
                  <marker id="arrow-other" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
                    <polygon points="0,0 9,3.5 0,7" fill="#5f6c7b" />
                  </marker>
                </defs>

              {layout.lanes.map((lane) => (
                <g key={lane.layer}>
                  <rect x={lane.x} y={lane.y} width={lane.width} height={lane.height} rx="18" className="lane" />
                  <text x={lane.x + 16} y={lane.y + 30} className="lane-title">{lane.layer}</text>
                </g>
              ))}

              {!visibleEdges.length && (
                <text x={layout.width / 2} y={58} textAnchor="middle" className="no-edge-note">
                  No module links at this depth under current filter.
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
                const selected = selectedByEdge || (!selectedEdgeId && relatedToSelectedModule);
                const dimmed = selectedEdgeId
                  ? edge.id !== selectedEdgeId
                  : selectedIsVisible && !relatedToSelectedModule;

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

                return (
                  <g
                    key={edge.id}
                    className="edge-group"
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedEdgeId(edge.id);
                      setSelectedModuleId(edge.src_id);
                    }}
                  >
                    <path
                      d={geometry.path}
                      className="edge-hitbox"
                      markerEnd={marker}
                    />
                    <path
                      d={geometry.path}
                      className={cls.join(" ")}
                      markerEnd={marker}
                      style={{
                        strokeWidth: selectedByEdge
                          ? baseWidth + 2.3
                          : selected
                            ? baseWidth + 1.4
                            : baseWidth + weightWidth,
                      }}
                    />
                    <text className={`edge-label ${selected ? "selected" : ""}`} x={geometry.labelX} y={geometry.labelY}>
                      {clip(edge.label, 34)}
                    </text>
                  </g>
                );
              })}

                {layout.nodes.map((node) => {
                  const isActive = node.id === selectedModuleId;
                  const canDrill = hasChildren(node.id);

                  return (
                    <g
                      key={node.id}
                      className={`node ${isActive ? "active" : ""} ${draggingNodeId === node.id ? "dragging" : ""}`}
                      onClick={() => activateNode(node.id)}
                      onPointerDown={(event) => startNodeDrag(event, node)}
                      onPointerEnter={(event) => showNodeHover(event, node.id)}
                      onPointerMove={(event) => moveNodeHover(event, node.id)}
                      onPointerLeave={() => hideNodeHover(node.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          activateNode(node.id);
                        }
                      }}
                    >
                      <rect x={node.x} y={node.y} width={node.width} height={node.height} rx="14" />
                      <text x={node.x + 14} y={node.y + 26} className="title">{clip(node.name, 34)}</text>
                      <text x={node.x + 14} y={node.y + 46} className="meta">Layer: {node.layer} · L{node.level}</text>
                      {node.summary && (
                        <text x={node.x + 14} y={node.y + 66} className="summary-line">
                          {clip(node.summary, 20)}
                        </text>
                      )}
                      {node.summary && (
                        <text
                          x={node.x + node.width - 14}
                          y={node.y + 66}
                          textAnchor="end"
                          className={`summary-tag ${node.summarySource === "llm" ? "llm" : "fallback"}`}
                        >
                          {node.summarySource === "llm" ? "LLM" : "Fallback"}
                        </text>
                      )}

                      {node.inPorts.slice(0, 3).map((port, idx) => (
                        <text key={`${port.id}-in`} x={node.x + 14} y={node.portStartY + idx * 16} className="port in-port">
                          IN {clip(`${port.protocol} ${port.name}`, 22)}
                        </text>
                      ))}
                      {node.outPorts.slice(0, 3).map((port, idx) => (
                        <text
                          key={`${port.id}-out`}
                          x={node.x + node.width - 14}
                          y={node.portStartY + idx * 16}
                          textAnchor="end"
                          className="port out-port"
                        >
                          OUT {clip(`${port.protocol} ${port.name}`, 22)}
                        </text>
                      ))}

                      {canDrill && (
                        <text
                          x={node.x + node.width - 12}
                          y={node.y + node.height - 12}
                          textAnchor="end"
                          className="drill-hint"
                        >
                          click to drill
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

        <section className="reports">
          <article>
            <h3>Diff Report</h3>
            {diffReport ? (
              <ul>
                <li>Added modules: {diffReport.added_modules?.length || 0}</li>
                <li>Removed modules: {diffReport.removed_modules?.length || 0}</li>
                <li>Added ports: {diffReport.added_ports?.length || 0}</li>
                <li>Removed ports: {diffReport.removed_ports?.length || 0}</li>
                <li>API surface changes: {diffReport.api_surface_changes?.length || 0}</li>
                <li>Violations: {diffReport.violations?.length || 0}</li>
                <li>Cycles: {diffReport.cycles?.length || 0}</li>
              </ul>
            ) : (
              <p>No diff result yet.</p>
            )}
          </article>

          <article>
            <h3>CI Gate</h3>
            {ciResult ? (
              <ul>
                <li>Status: {ciResult.ok ? "PASS" : "FAIL"}</li>
                <li>Exit code: {ciResult.exit_code}</li>
                <li>Violations: {ciResult.report?.violations?.length || 0}</li>
                <li>Cycles: {ciResult.report?.cycles?.length || 0}</li>
              </ul>
            ) : (
              <p>No CI result yet.</p>
            )}
          </article>
        </section>

        {error && <div className="error-banner">{error}</div>}
      </main>
    </div>
  );
}

export default App;
