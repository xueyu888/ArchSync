import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildArchitecture, diffArchitecture, fetchModel, healthCheck, runCIGate } from "./api";
import "./App.css";
import * as studio from "./studio/helpers";
import { DiagramDefs } from "./studio/DiagramDefs";
import { ModuleContainerHeaders } from "./studio/ModuleContainerHeaders";
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
  const [showLanes, setShowLanes] = useState(false);
  const [autoHidePins, setAutoHidePins] = useState(true);
  const [selectedAroundHops, setSelectedAroundHops] = useState(-1);
  const [edgeFilters, setEdgeFilters] = useState({});
  const [busy, setBusy] = useState({ build: false, diff: false, ci: false, refresh: false });
  const [diffInput, setDiffInput] = useState({ base: "main", head: "HEAD" });
  const [diffReport, setDiffReport] = useState(null);
  const [ciResult, setCiResult] = useState(null);
  const [manualLayouts, setManualLayouts] = useState({});
  const [draggingNodeId, setDraggingNodeId] = useState("");
  const [dragPreview, setDragPreview] = useState(null);
  const [pendingScrollId, setPendingScrollId] = useState("");
  const [panningCanvas, setPanningCanvas] = useState(false);
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
  const groupDragRef = useRef(null);
  const panRef = useRef(null);
  const suppressClickRef = useRef(false);
  const effectiveModules = useMemo(() => {
    return (model?.modules || []).map((item) => {
      const edit = moduleEdits[item.id] || {};
      const name = typeof edit.name === "string" && edit.name.trim() ? edit.name.trim() : item.name;
      return { ...item, name };
    });
  }, [model, moduleEdits]);
  const moduleById = useMemo(() => studio.buildModuleLookup(effectiveModules), [effectiveModules]);
  const childrenByParent = useMemo(() => studio.buildChildrenLookup(effectiveModules), [effectiveModules]);
  const descendantsByModule = useMemo(() => studio.buildDescendantsLookup(effectiveModules), [effectiveModules]);
  const evidenceById = useMemo(() => studio.buildEvidenceLookup(snapshot?.evidences || []), [snapshot]);
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
  const stats = useMemo(() => studio.summarizeModel(model, snapshot), [model, snapshot]);
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
    () => studio.collectSemanticViewGraph(model, currentParentId, childrenByParent, moduleById, expandedModuleIds),
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
      const savedShowLanes = window.localStorage.getItem("archsync.showLanes");
      if (savedShowLanes === "1") setShowLanes(true);
      if (savedShowLanes === "0") setShowLanes(false);
      const savedAutoHidePins = window.localStorage.getItem("archsync.autoHidePins");
      if (savedAutoHidePins === "0") setAutoHidePins(false);
      if (savedAutoHidePins === "1") setAutoHidePins(true);
      const savedZoom = Number(window.localStorage.getItem("archsync.zoom") || "");
      if (Number.isFinite(savedZoom) && savedZoom > 0) {
        setZoom(studio.clampZoom(savedZoom));
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
      window.localStorage.setItem("archsync.showLanes", showLanes ? "1" : "0");
      window.localStorage.setItem("archsync.autoHidePins", autoHidePins ? "1" : "0");
    } catch {
      // ignore storage errors
    }
  }, [showLanes, autoHidePins]);
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
  const aroundNodeIds = useMemo(() => {
    if (selectedAroundHops < 0 || !selectedModuleId || !viewGraph.nodes.some((item) => item.id === selectedModuleId)) {
      return null;
    }
    const keep = new Set([selectedModuleId]);
    let frontier = new Set([selectedModuleId]);
    for (let hop = 0; hop < selectedAroundHops && frontier.size; hop += 1) {
      const next = new Set();
      for (const edge of viewGraph.edges) {
        if (frontier.has(edge.src_id) && !keep.has(edge.dst_id)) {
          keep.add(edge.dst_id);
          next.add(edge.dst_id);
        }
        if (frontier.has(edge.dst_id) && !keep.has(edge.src_id)) {
          keep.add(edge.src_id);
          next.add(edge.src_id);
        }
      }
      frontier = next;
    }
    return keep;
  }, [selectedAroundHops, selectedModuleId, viewGraph.nodes, viewGraph.edges]);
  const scopedNodes = useMemo(
    () => (aroundNodeIds ? viewGraph.nodes.filter((item) => aroundNodeIds.has(item.id)) : viewGraph.nodes),
    [viewGraph.nodes, aroundNodeIds],
  );
  const scopedEdges = useMemo(
    () => (aroundNodeIds
      ? viewGraph.edges.filter((edge) => aroundNodeIds.has(edge.src_id) && aroundNodeIds.has(edge.dst_id))
      : viewGraph.edges),
    [viewGraph.edges, aroundNodeIds],
  );
  const maxEdgeCount = useMemo(
    () => Math.max(1, ...scopedEdges.map((edge) => Math.max(1, Number(edge.count) || 1))),
    [scopedEdges],
  );
  const effectiveEdgeMinCount = Math.min(Math.max(1, edgeMinCount), maxEdgeCount);
  const selectedScopeNodeIds = useMemo(() => {
    if (!selectedModuleId) {
      return null;
    }
    const scope = descendantsByModule[selectedModuleId];
    if (!scope) {
      return new Set([selectedModuleId]);
    }
    const keep = new Set();
    for (const node of scopedNodes) {
      if (scope.has(node.id)) {
        keep.add(node.id);
      }
    }
    return keep.size ? keep : new Set([selectedModuleId]);
  }, [selectedModuleId, scopedNodes, descendantsByModule]);
  const selectedInCurrentDepth = useMemo(
    () => {
      if (!selectedModuleId) {
        return false;
      }
      if (scopedNodes.some((item) => item.id === selectedModuleId)) {
        return true;
      }
      const scope = descendantsByModule[selectedModuleId];
      if (!scope) {
        return false;
      }
      return scopedNodes.some((item) => scope.has(item.id));
    },
    [selectedModuleId, scopedNodes, descendantsByModule],
  );
  useEffect(() => {
    if (edgeScope === "selected" && !selectedInCurrentDepth) {
      setEdgeScope("all");
    }
  }, [edgeScope, selectedInCurrentDepth]);
  useEffect(() => {
    if (selectedAroundHops >= 0 && !selectedInCurrentDepth) {
      setSelectedAroundHops(-1);
    }
  }, [selectedAroundHops, selectedInCurrentDepth]);
  const visibleEdges = useMemo(
    () => scopedEdges
      .filter((edge) => edgeFilters[edge.kind] !== false)
      .filter((edge) => (Number(edge.count) || 1) >= effectiveEdgeMinCount)
      .filter((edge) => {
        if (edgeScope !== "selected" || !selectedInCurrentDepth || !selectedScopeNodeIds) {
          return true;
        }
        return selectedScopeNodeIds.has(edge.src_id) || selectedScopeNodeIds.has(edge.dst_id);
      }),
    [scopedEdges, edgeFilters, effectiveEdgeMinCount, edgeScope, selectedInCurrentDepth, selectedScopeNodeIds],
  );
  const autoLayout = useMemo(
    () => studio.layoutGraph(
      scopedNodes,
      visibleEdges,
      portsByModule,
      llmSummaries,
      llmSummarySource,
      moduleById,
      viewGraph.focusPathIds,
      Array.from(expandedModuleIds),
      selectedModuleId,
    ),
    [
      scopedNodes,
      viewGraph.focusPathIds,
      visibleEdges,
      portsByModule,
      llmSummaries,
      llmSummarySource,
      moduleById,
      expandedModuleIds,
      selectedModuleId,
    ],
  );
  const manualPositionsForCurrent = useMemo(
    () => (currentParentId ? manualLayouts[currentParentId] || {} : {}),
    [manualLayouts, currentParentId],
  );
  const layout = useMemo(
    () => studio.applyManualLayout(autoLayout, manualPositionsForCurrent),
    [autoLayout, manualPositionsForCurrent],
  );
  const renderLayout = useMemo(() => {
    if (!dragPreview || dragPreview.parentId !== currentParentId) {
      return layout;
    }
    return studio.applyManualLayout(layout, dragPreview.positions || {});
  }, [layout, dragPreview, currentParentId]);
  const drawNodeById = useMemo(
    () => Object.fromEntries(renderLayout.nodes.map((item) => [item.id, item])),
    [renderLayout.nodes],
  );
  const edgeGeometryById = useMemo(
    () => studio.buildEdgeGeometries(visibleEdges, drawNodeById),
    [visibleEdges, drawNodeById],
  );
  const containerById = useMemo(
    () => Object.fromEntries((renderLayout.moduleContainers || []).map((container) => [container.id, container])),
    [renderLayout.moduleContainers],
  );
  const containerMembersById = useMemo(
    () => Object.fromEntries((renderLayout.containerDefs || []).map((def) => [def.id, def.memberIds || []])),
    [renderLayout.containerDefs],
  );
  const activeContainerChain = useMemo(() => {
    const anchor = selectedModuleId && moduleById[selectedModuleId]
      ? selectedModuleId
      : systemModule?.id || "";
    if (!anchor) {
      return [];
    }
    const path = studio.lineage(anchor, moduleById).map((item) => item.id);
    return path.filter((moduleId) => !!containerById[moduleId]);
  }, [selectedModuleId, systemModule, moduleById, containerById]);
  const activeContainerId = activeContainerChain.length ? activeContainerChain[activeContainerChain.length - 1] : "";
  const activeContainerIdSet = useMemo(() => new Set(activeContainerChain), [activeContainerChain]);
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
    const path = studio.lineage(selectedModule.id, moduleById).reverse();
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
    const path = studio.lineage(selectedModule.id, moduleById).reverse();
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
        incoming.push(`${sourceName} · ${studio.humanizeKind(edge.kind)} · ${edge.label}`);
      }
      if (edge.src_id === selectedModuleId) {
        const targetName = moduleById[edge.dst_id]?.name || edge.dst_id;
        outgoing.push(`${targetName} · ${studio.humanizeKind(edge.kind)} · ${edge.label}`);
      }
    }
    return { incoming, outgoing };
  }, [model, moduleById, selectedModuleId]);
  const breadcrumbAnchorId = useMemo(() => {
    if (selectedModuleId && moduleById[selectedModuleId]) {
      return selectedModuleId;
    }
    if (currentParentId && moduleById[currentParentId]) {
      return currentParentId;
    }
    return systemModule?.id || "";
  }, [selectedModuleId, currentParentId, systemModule, moduleById]);
  const breadcrumb = useMemo(
    () => (breadcrumbAnchorId ? studio.lineage(breadcrumbAnchorId, moduleById) : []),
    [breadcrumbAnchorId, moduleById],
  );
  const currentDepth = useMemo(() => {
    if (!breadcrumbAnchorId || !moduleById[breadcrumbAnchorId]) {
      return 0;
    }
    return moduleById[breadcrumbAnchorId].level;
  }, [breadcrumbAnchorId, moduleById]);
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
  const selectionNeighborIds = useMemo(() => {
    if (!selectedModuleId) return new Set();
    const neighborIds = new Set();
    for (const edge of visibleEdges) if (edge.src_id === selectedModuleId && edge.dst_id !== selectedModuleId) neighborIds.add(edge.dst_id); else if (edge.dst_id === selectedModuleId && edge.src_id !== selectedModuleId) neighborIds.add(edge.src_id);
    return neighborIds;
  }, [selectedModuleId, visibleEdges]);
  function appendLog(text, severity = "info") {
    const item = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: studio.nowTimeLabel(),
      severity,
      text: String(text || ""),
    };
    setLogs((old) => [...old.slice(-399), item]);
  }
  function appendMessage(severity, text, source = "studio") {
    const normalized = ["info", "warning", "error"].includes(severity) ? severity : "info";
    const item = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: studio.nowTimeLabel(),
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
  function collapseAllExpanded() {
    setSelectedEdgeId("");
    setActivePortFocus(null);
    setExpandedModuleIds(new Set());
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
    const target = event.target;
    if (target instanceof Element) {
      if (
        target.closest("g.node-expand-toggle")
        || target.closest("g.node-agg-badge")
        || target.closest("g.node-port-group")
      ) {
        return;
      }
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
      positions: { [node.id]: { x: node.x, y: node.y } },
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
    const nextX = Math.min(maxX, Math.max(minX, studio.snapToGrid(point.x - drag.offsetX)));
    const nextY = Math.min(maxY, Math.max(minY, studio.snapToGrid(point.y - drag.offsetY)));
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
        positions: { [drag.nodeId]: { x: nextX, y: nextY } },
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
  function startGroupDrag(event, containerId) {
    if (!currentParentId || event.button !== 0) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.closest("g.module-container-toggle")) {
      return;
    }
    const memberIds = containerMembersById[containerId] || [];
    if (!memberIds.length) {
      return;
    }
    const point = toSvgPoint(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    const positions = {};
    for (const nodeId of memberIds) {
      const node = drawNodeById[nodeId];
      if (node) {
        positions[nodeId] = { x: node.x, y: node.y };
      }
    }
    if (!Object.keys(positions).length) {
      return;
    }
    groupDragRef.current = {
      pointerId: event.pointerId,
      parentId: currentParentId,
      containerId,
      startPoint: point,
      startPositions: positions,
      lastPositions: positions,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragPreview({
      parentId: currentParentId,
      positions,
    });
    setHoverCard(null);
    event.stopPropagation();
  }
  function moveGroupDrag(event) {
    const drag = groupDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.parentId !== currentParentId) {
      return;
    }
    const point = toSvgPoint(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    const dx = point.x - drag.startPoint.x;
    const dy = point.y - drag.startPoint.y;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      drag.moved = true;
      suppressClickRef.current = true;
    }
    const nextPositions = {};
    for (const [nodeId, start] of Object.entries(drag.startPositions)) {
      nextPositions[nodeId] = {
        x: studio.snapToGrid(start.x + dx),
        y: studio.snapToGrid(start.y + dy),
      };
    }
    drag.lastPositions = nextPositions;
    setDragPreview({
      parentId: drag.parentId,
      positions: nextPositions,
    });
  }
  function finishGroupDrag(event) {
    const drag = groupDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    if (drag.moved && drag.parentId === currentParentId) {
      setManualLayouts((old) => ({
        ...old,
        [currentParentId]: {
          ...(old[currentParentId] || {}),
          ...drag.lastPositions,
        },
      }));
    }
    groupDragRef.current = null;
    setDragPreview(null);
  }
  function startCanvasPan(event) {
    if (event.button !== 0 && event.button !== 1) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const fromInteractive = target.closest("g.node")
      || target.closest("g.edge-group")
      || target.closest("g.module-container-header-layer")
      || target.closest("g.module-container-toggle")
      || target.closest("g.hierarchy-chip-toggle");
    if (fromInteractive && event.button !== 1) {
      return;
    }
    const wrap = canvasWrapRef.current;
    if (!wrap) {
      return;
    }
    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: wrap.scrollLeft,
      scrollTop: wrap.scrollTop,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setPanningCanvas(true);
  }
  function moveCanvasPan(event) {
    const pan = panRef.current;
    const wrap = canvasWrapRef.current;
    if (!pan || !wrap || pan.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - pan.startX;
    const dy = event.clientY - pan.startY;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      pan.moved = true;
      suppressClickRef.current = true;
    }
    wrap.scrollLeft = pan.scrollLeft - dx;
    wrap.scrollTop = pan.scrollTop - dy;
  }
  function finishCanvasPan(event) {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) {
      return;
    }
    panRef.current = null;
    setPanningCanvas(false);
  }
  function hasChildren(moduleId) {
    return (childrenByParent[moduleId] || []).length > 0;
  }
  const scrollToVisibleNode = useCallback((moduleId) => {
    const wrap = canvasWrapRef.current;
    const node = drawNodeById[moduleId];
    const container = containerById[moduleId];
    const target = node || container;
    if (!wrap || !target) {
      return false;
    }
    const padding = 12;
    const targetLeft = target.x * zoom - (wrap.clientWidth - target.width * zoom) / 2 + padding;
    const targetTop = target.y * zoom - (wrap.clientHeight - target.height * zoom) / 2 + padding;
    wrap.scrollLeft = Math.max(0, Math.round(targetLeft));
    wrap.scrollTop = Math.max(0, Math.round(targetTop));
    return true;
  }, [drawNodeById, containerById, zoom]);
  function selectModule(moduleId, options = {}) {
    const module = moduleById[moduleId];
    if (!module) {
      return;
    }
    setSelectedEdgeId("");
    setActivePortFocus(null);
    setSelectedModuleId(moduleId);
    setSelectedAroundHops(-1);
    if (options.scroll) {
      setPendingScrollId(moduleId);
    }
  }
  function toggleModuleExpand(moduleId) {
    if (!moduleById[moduleId]) {
      return;
    }
    setSelectedEdgeId("");
    setActivePortFocus(null);
    setSelectedModuleId(moduleId);
    if (!hasChildren(moduleId)) return;
    setExpandedModuleIds((old) => {
      const next = old.has(moduleId)
        ? studio.collapseExpandedSubtree(old, moduleId, childrenByParent, "")
        : new Set(old).add(moduleId);
      return studio.setsEqual(next, old) ? old : next;
    });
    setPendingScrollId(moduleId);
  }
  function collapseContainer(containerId) {
    if (!containerId || !moduleById[containerId]) {
      return;
    }
    setSelectedEdgeId("");
    setActivePortFocus(null);
    setSelectedModuleId(containerId);
    setExpandedModuleIds((old) => {
      const next = studio.collapseExpandedSubtree(old, containerId, childrenByParent, "");
      return studio.setsEqual(next, old) ? old : next;
    });
    setPendingScrollId(containerId);
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
    setSelectedEdgeId(""); setActivePortFocus(null);
    setSelectedModuleId(moduleId);
    setExpandedModuleIds((old) => {
      const next = new Set(old);
      for (const targetId of targets) {
        if (moduleById[targetId] && hasChildren(targetId)) {
          next.add(targetId);
        }
      }
      return studio.setsEqual(next, old) ? old : next;
    });
  }
  function activateNode(moduleId) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setSelectedEdgeId("");
    setActivePortFocus(null);
    setSelectedModuleId(moduleId);
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
    const current = moduleById[breadcrumbAnchorId];
    if (!current || !current.parent_id) {
      return;
    }
    selectModule(current.parent_id, { scroll: true });
  }
  function jumpToCrumb(moduleId) {
    selectModule(moduleId, { scroll: true });
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
    const rootId = systemModule.id;
    const safeSelected = selectedModuleId && moduleById[selectedModuleId] ? selectedModuleId : rootId;
    const nextViewRoot = focusMode ? safeSelected : rootId;
    if (nextViewRoot !== currentParentId) {
      setCurrentParentId(nextViewRoot);
    }
    if (safeSelected !== selectedModuleId) {
      setSelectedModuleId(safeSelected);
    }
    setExpandedModuleIds((old) => {
      const validIds = new Set(Object.keys(moduleById));
      const pruned = new Set(Array.from(old).filter((id) => validIds.has(id)));
      return studio.setsEqual(pruned, old) ? old : pruned;
    });
  }, [systemModule, moduleById, childrenByParent, currentParentId, selectedModuleId, focusMode]);
  useEffect(() => {
    setSelectedEdgeId("");
    setActivePortFocus(null);
    setSelectedAroundHops(-1);
    setHoverNodeId("");
    dragRef.current = null;
    panRef.current = null;
    groupDragRef.current = null;
    setDraggingNodeId("");
    setDragPreview(null);
    setPendingScrollId("");
    setPanningCanvas(false);
    setHoverCard(null);
  }, [currentParentId]);
  useEffect(() => {
    if (!pendingScrollId) {
      return;
    }
    if (scrollToVisibleNode(pendingScrollId)) {
      setPendingScrollId("");
    }
  }, [pendingScrollId, renderLayout, zoom, currentParentId, scrollToVisibleNode]);
  function zoomToFit() {
    const wrap = canvasWrapRef.current;
    if (!wrap || !renderLayout.width || !renderLayout.height) {
      return;
    }
    const padding = 28;
    const fitX = (wrap.clientWidth - padding) / renderLayout.width;
    const fitY = (wrap.clientHeight - padding) / renderLayout.height;
    const target = studio.clampZoom(Math.min(fitX, fitY));
    setZoom(target);
    appendMessage("info", `Zoom to fit: ${Math.round(target * 100)}%.`, "console");
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
      appendMessage("info", "Commands: help, reload, zoomfit, diff", "console");
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
    setZoom((value) => studio.clampZoom(value * factor));
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
                {studio.humanizeKind(kind)}
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
              data-id={item.id}
              data-level={String(item.level)}
              className={`module-item ${selectedModuleId === item.id ? "active" : ""}`}
              onClick={() => selectModule(item.id, { scroll: true })}
              onDoubleClick={() => {
                if (!systemModule) {
                  return;
                }
                selectModule(item.id, { scroll: true });
                setExpandedModuleIds((old) => {
                  const next = studio.withFocusPathExpanded(
                    old,
                    item.id,
                    childrenByParent,
                    moduleById,
                    systemModule.id,
                    { includeSelf: false },
                  );
                  return studio.setsEqual(next, old) ? old : next;
                });
              }}
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
            <button type="button" onClick={() => setShowLanes((value) => !value)} disabled={focusMode}>
              {showLanes ? "Hide Lanes" : "Show Lanes"}
            </button>
            <button type="button" onClick={() => setZoom((value) => studio.clampZoom(value - 0.1))}>-</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => setZoom((value) => studio.clampZoom(value + 0.1))}>+</button>
            <button type="button" onClick={zoomToFit}>Zoom Fit</button>
            <span className="zoom-hint">Ctrl+Wheel Zoom</span>
            <button type="button" onClick={resetCurrentLayout}>Auto Layout</button>
            <button type="button" onClick={resetAllLayouts}>Reset All</button>
            <button type="button" onClick={collapseAllExpanded}>Collapse All</button>
            <button type="button" onClick={() => setShowEdgeLabels((old) => !old)}>
              {showEdgeLabels ? "Hide Labels" : "Show Labels"}
            </button>
            <button type="button" onClick={() => setAutoHidePins((old) => !old)}>{autoHidePins ? "Pins Auto" : "Pins All"}</button>
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
            <div className="edge-scope-toggle" role="group" aria-label="Around selected">
              <button type="button" onClick={() => setSelectedAroundHops((old) => (old <= 1 ? -1 : old - 1))} disabled={!selectedInCurrentDepth || selectedAroundHops <= -1}>Remove Around</button>
              <button type="button" onClick={() => setSelectedAroundHops((old) => Math.min(4, old < 0 ? 1 : old + 1))} disabled={!selectedInCurrentDepth}>Add Around</button>
            </div>
            {edgeKinds.map((kind) => (
              <span key={kind} className={`legend-item legend-${kind} ${edgeFilters[kind] !== false ? "active" : ""}`}>
                {studio.humanizeKind(kind)}
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
                  className={`crumb ${item.id === breadcrumbAnchorId ? "active" : ""}`}
                  onClick={() => jumpToCrumb(item.id)}
                >
                  <span className="crumb-title">{item.name}</span>
                  <span className="crumb-level">L{item.level}</span>
                </button>
                {item.level > 0 && hasChildren(item.id) && (
                  <button
                    type="button"
                    className={`crumb-toggle ${expandedModuleIds.has(item.id) ? "expanded" : "collapsed"}`}
                    aria-label={`${expandedModuleIds.has(item.id) ? "Collapse" : "Expand"} ${item.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleModuleExpand(item.id);
                    }}
                  >
                    {expandedModuleIds.has(item.id) ? "-" : "+"}
                  </button>
                )}
              </span>
            ))}
          </div>
          <div className="drillbar-meta">
            <strong>Selected L{currentDepth}</strong>
            <span>{scopedNodes.length} modules</span>
            <span>{visibleEdges.length} links</span>
            <span>Drag modules to rearrange · dblclick to expand/collapse</span>
            {moduleById[breadcrumbAnchorId]?.parent_id && (
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
                    <span>{studio.humanizeKind(edge.kind)} · {edge.label}</span>
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
                  <p>{studio.humanizeKind(selectedEdge.kind)} · {selectedEdge.label}</p>
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
            <section
              className={`canvas-wrap hand-pan ${panningCanvas ? "panning" : ""}`}
              ref={canvasWrapRef}
              onWheel={handleCanvasWheel}
              onPointerDown={startCanvasPan}
              onPointerMove={moveCanvasPan}
              onPointerUp={finishCanvasPan}
              onPointerCancel={finishCanvasPan}
            >
              {!model && <p className="empty">No model loaded yet.</p>}
              {model && (
                <>
                  <svg
                    ref={svgRef}
                    className="diagram"
                    width={Math.max(1, Math.round(renderLayout.width * zoom) + 600)}
                    height={Math.max(1, Math.round(renderLayout.height * zoom) + 360)}
                    viewBox={`0 0 ${renderLayout.width} ${renderLayout.height}`}
                    onPointerMove={(event) => {
                      moveNodeDrag(event);
                      moveGroupDrag(event);
                    }}
                    onPointerUp={(event) => {
                      finishNodeDrag(event);
                      finishGroupDrag(event);
                    }}
                    onPointerCancel={(event) => {
                      finishNodeDrag(event);
                      finishGroupDrag(event);
                    }}
                    onPointerLeave={() => {
                      setHoverNodeId("");
                      setHoverCard(null);
                    }}
                    onClick={() => {
                      setSelectedEdgeId("");
                      setActivePortFocus(null);
                    }}
                  >
                <DiagramDefs />
                  {showLanes && renderLayout.lanes.map((lane) => (
                    <g key={lane.layer}>
                      <rect x={lane.x} y={lane.y} width={lane.width} height={lane.height} rx="18" className="lane" />
                      <text x={lane.x + 16} y={lane.y + 30} className="lane-title">{lane.layer}</text>
                    </g>
                  ))}
                  {(renderLayout.moduleContainers || []).map((container) => {
                    const focused = container.id === activeContainerId;
                    const inChain = activeContainerIdSet.has(container.id);
                    const level = Math.max(1, Number(container.level || 1));
                    const baseStrokeWidth = Math.min(4.2, 1.85 + (level - 1) * 0.2);
                    const chainStrokeWidth = baseStrokeWidth + 0.35;
                    const focusedStrokeWidth = baseStrokeWidth + 0.95;
                    return (
                      <g
                        key={`container-body-${container.id}`}
                        data-id={container.id}
                        data-parent-id={container.parentId || ""}
                        data-level={String(level)}
                        className={`module-container module-container-body-layer ${focused ? "focused" : ""} ${inChain ? "chain" : ""}`}
                        style={{
                          "--container-stroke-width": `${baseStrokeWidth}px`,
                          "--container-stroke-width-chain": `${chainStrokeWidth}px`,
                          "--container-stroke-width-focused": `${focusedStrokeWidth}px`,
                        }}
                      >
                        {focused && (
                          <rect
                            x={container.x}
                            y={container.y}
                            width={container.width}
                            height={container.height}
                            rx="16"
                            className="module-container-body-glow"
                          />
                        )}
                        <rect
                          x={container.x}
                          y={container.y}
                          width={container.width}
                          height={container.height}
                          rx="16"
                          className="module-container-body"
                        />
                        <rect
                          x={container.x}
                          y={container.y}
                          width={container.width}
                          height={container.height}
                          rx="16"
                          className="module-container-hitbox"
                          onPointerDown={(event) => startGroupDrag(event, container.id)}
                        />
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
                if (selectedEdgeId) {
                  dimmed = edge.id !== selectedEdgeId;
                } else if ((edgeScope === "selected" || activePortFocus) && selectedIsVisible) {
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
                        {studio.clip(edge.label, denseLabelMode ? 22 : 34)}
                      </text>
                    )}
                  </g>
                );
              })}
                  <ModuleContainerHeaders
                    containers={renderLayout.moduleContainers || []}
                    activeContainerIdSet={activeContainerIdSet}
                    activeContainerId={activeContainerId}
                    onCollapseContainer={collapseContainer}
                    onDragContainer={(event, containerId) => startGroupDrag(event, containerId)}
                  />
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
                  const hintY = node.y + node.height - (outerOutCount > 0 ? 28 : 12);
                  const titleX = node.x + (canExpand ? 46 : 14);
                  const isHoveredNode = hoverNodeId === node.id;
                  const isNeighborNode = hoverContext.neighborIds.has(node.id) || selectionNeighborIds.has(node.id);
                  const dimmedByHover = false;
                  const dimmedBySelection = (!hoverNodeId && edgeScope === "selected" && selectedIsVisible && selectedModuleId && node.id !== selectedModuleId && !isNeighborNode);
                  const showPins = !autoHidePins || isActive || isHoveredNode || isNeighborNode || (activePortFocus && activePortFocus.nodeId === node.id);
                  const dimmed = dimmedByHover || dimmedBySelection;
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
                    dimmed ? "dimmed" : "",
                  ].filter(Boolean).join(" ");
                    return (
                      <g
                        key={node.id}
                        data-id={node.id}
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
                      <text x={titleX} y={node.y + 26} className="title">{studio.clipByUnits(node.name, node.portTextUnits + 1)}</text>
                      <text x={node.x + 14} y={node.y + 46} className="meta">Layer: {node.layer} · L{node.level}</text>
                      {showPins && node.summaryLines.map((line, idx) => (
                        <text key={`summary-${node.id}-${line}-${idx}`} x={node.x + 14} y={node.y + node.summaryY + idx * 14} className="summary-line">
                          {line}
                        </text>
                      ))}
                      {showPins && !!node.summaryLines.length && (
                        <text x={node.x + node.width - 14} y={node.y + node.summaryY} textAnchor="end" className={`summary-tag ${node.summarySource === "llm" ? "llm" : "fallback"}`}>{node.summarySource === "llm" ? "LLM" : "Fallback"}</text>
                      )}
                      {showPins && node.displayInPorts.map((port, idx) => {
                        const visualState = getPortVisualState(node.id, port, "in");
                        const isBus = studio.isInterfaceProtocol(port.protocol);
                        const portY = node.portStartY + idx * 16 - 4;
                        return (
                          <g
                            key={`${port.id}-in`}
                            className="node-port-group in"
                            onClick={(event) => {
                              event.stopPropagation();
                              const portId = port.id || `in-${port.name}-${port.protocol}`;
                              setActivePortFocus((old) => (
                                old && old.nodeId === node.id && old.portId === portId
                                  ? null
                                  : { nodeId: node.id, portId, direction: "in" }
                              ));
                            }}
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                              event.preventDefault();
                              const portId = port.id || `in-${port.name}-${port.protocol}`;
                              setActivePortFocus({ nodeId: node.id, portId, direction: "in" });
                              setEdgeScope("selected");
                              setSelectedAroundHops((old) => (old < 1 ? 1 : old));
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
                              IN {studio.clipByUnits(studio.formatPortText(port), node.portTextUnits)}
                            </text>
                          </g>
                        );
                      })}
                      {showPins && node.inOverflow > 0 && (
                        <text
                          x={node.x + 14}
                          y={node.portStartY + node.displayInPorts.length * 16}
                          className="port in-port more-port"
                        >
                          +{node.inOverflow} more
                        </text>
                      )}
                      {showPins && node.displayOutPorts.map((port, idx) => {
                        const visualState = getPortVisualState(node.id, port, "out");
                        const isBus = studio.isInterfaceProtocol(port.protocol);
                        const portY = node.portStartY + idx * 16 - 4;
                        return (
                          <g
                            key={`${port.id}-out`}
                            className="node-port-group out"
                            onClick={(event) => {
                              event.stopPropagation();
                              const portId = port.id || `out-${port.name}-${port.protocol}`;
                              setActivePortFocus((old) => (
                                old && old.nodeId === node.id && old.portId === portId
                                  ? null
                                  : { nodeId: node.id, portId, direction: "out" }
                              ));
                            }}
                            onDoubleClick={(event) => {
                              event.stopPropagation();
                              event.preventDefault();
                              const portId = port.id || `out-${port.name}-${port.protocol}`;
                              setActivePortFocus({ nodeId: node.id, portId, direction: "out" });
                              setEdgeScope("selected");
                              setSelectedAroundHops((old) => (old < 1 ? 1 : old));
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
                              OUT {studio.clipByUnits(studio.formatPortText(port), node.portTextUnits)}
                            </text>
                          </g>
                        );
                      })}
                      {showPins && node.outOverflow > 0 && (
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
                            x={node.x + 12}
                            y={node.y + 8}
                            width="24"
                            height="14"
                            rx="7"
                            className="expand-toggle-bg"
                          />
                          <text
                            x={node.x + 24}
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
                          y={hintY}
                          textAnchor="end"
                        className="drill-hint"
                      >
                          dblclick to expand/collapse
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
