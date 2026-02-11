from __future__ import annotations

import re
from collections import defaultdict
from pathlib import PurePosixPath

from archsync.config import RulesConfig
from archsync.llm.provider import ModuleDraft, build_provider
from archsync.schemas import (
    ArchitectureEdge,
    ArchitectureModel,
    FactsSnapshot,
    ModuleNode,
    PortNode,
)
from archsync.utils import path_matches, stable_id, utc_now_iso


def _pick_layer(path: str, rules: RulesConfig) -> str:
    for rule in rules.layers:
        if path_matches(path, rule.match):
            return rule.name
    return rules.default_layer


def _group_paths(path: str, depth: int) -> list[str]:
    parts = list(PurePosixPath(path).parts)
    if len(parts) <= 1:
        return []

    directories = parts[:-1]
    if not directories:
        return []

    # Keep compatibility with `module_depth` as the first grouping depth,
    # then continue drilling with deeper folders until the leaf file.
    root_depth = min(max(1, depth), len(directories))
    output = ["/".join(directories[:root_depth])]
    for idx in range(root_depth + 1, len(directories) + 1):
        output.append("/".join(directories[:idx]))
    return output


def _route_key(name: str) -> str:
    if " " in name:
        return name.split(" ", 1)[1].strip().lower()
    return name.strip().lower()


def _is_route_match(source: str, target: str) -> bool:
    if source == target:
        return True
    if source.startswith(target) or target.startswith(source):
        return True
    source_trim = source.split("?", 1)[0]
    target_trim = target.split("?", 1)[0]
    return source_trim == target_trim


CHINESE_RE = re.compile(r"[\u4e00-\u9fff]")


def _contains_chinese(text: str) -> bool:
    return bool(CHINESE_RE.search(text))


def _default_summary_for_module(
    node: ModuleNode,
    child_count: int,
    port_count: int,
    incoming_count: int,
    outgoing_count: int,
) -> str:
    if node.level == 0:
        return "系统顶层视图，汇总各层模块与主要连接关系。"
    if child_count > 0:
        return f"{node.layer}层容器模块，包含{child_count}个子模块。"
    if port_count > 0:
        return f"{node.layer}层功能模块，提供{port_count}个接口端口。"
    if incoming_count > 0 or outgoing_count > 0:
        return f"{node.layer}层实现模块，入链路{incoming_count}条、出链路{outgoing_count}条。"
    if node.path and "/" in node.path and "." in PurePosixPath(node.path).name:
        return f"{node.layer}层实现文件，承载具体业务逻辑。"
    return f"{node.layer}层基础模块，负责结构组织与协同。"


def _build_default_summaries(
    modules: list[ModuleNode],
    ports: list[PortNode],
    edges: list[ArchitectureEdge],
) -> dict[str, str]:
    child_count_by_parent: dict[str, int] = defaultdict(int)
    for node in modules:
        if node.parent_id:
            child_count_by_parent[node.parent_id] += 1

    port_count_by_module: dict[str, int] = defaultdict(int)
    for port in ports:
        port_count_by_module[port.module_id] += 1

    incoming_count_by_module: dict[str, int] = defaultdict(int)
    outgoing_count_by_module: dict[str, int] = defaultdict(int)
    for edge in edges:
        outgoing_count_by_module[edge.src_id] += 1
        incoming_count_by_module[edge.dst_id] += 1

    output: dict[str, str] = {}
    for node in modules:
        output[node.id] = _default_summary_for_module(
            node=node,
            child_count=child_count_by_parent.get(node.id, 0),
            port_count=port_count_by_module.get(node.id, 0),
            incoming_count=incoming_count_by_module.get(node.id, 0),
            outgoing_count=outgoing_count_by_module.get(node.id, 0),
        )
    return output


def build_architecture_model(
    snapshot: FactsSnapshot,
    rules: RulesConfig,
    llm_audit_dir,
) -> ArchitectureModel:
    system_id = f"system:{rules.system_name}"
    modules: list[ModuleNode] = [
        ModuleNode(
            id=system_id,
            name=rules.system_name,
            layer="System",
            level=0,
            path="/",
            parent_id=None,
            evidence_ids=[],
        )
    ]

    fact_module_to_file_node: dict[str, str] = {}
    fact_module_to_group_node: dict[str, str] = {}

    layer_nodes: dict[str, ModuleNode] = {}
    group_nodes: dict[str, ModuleNode] = {}

    for fact in snapshot.modules:
        layer = _pick_layer(fact.path, rules)

        if layer not in layer_nodes:
            layer_id = f"layer:{layer}"
            layer_nodes[layer] = ModuleNode(
                id=layer_id,
                name=layer,
                layer=layer,
                level=1,
                path=layer,
                parent_id=system_id,
                evidence_ids=[],
            )

        parent_id = layer_nodes[layer].id
        parent_level = 1
        deepest_group_id = parent_id

        for group_path in _group_paths(fact.path, rules.module_depth):
            group_id = stable_id("group", layer, group_path)
            if group_id not in group_nodes:
                group_nodes[group_id] = ModuleNode(
                    id=group_id,
                    name=PurePosixPath(group_path).name or group_path,
                    layer=layer,
                    level=parent_level + 1,
                    path=group_path,
                    parent_id=parent_id,
                    evidence_ids=[],
                )
            parent_id = group_id
            parent_level = group_nodes[group_id].level
            deepest_group_id = group_id

        file_node_id = stable_id("file", fact.path)
        file_node = ModuleNode(
            id=file_node_id,
            name=PurePosixPath(fact.path).name or fact.path,
            layer=layer,
            level=parent_level + 1,
            path=fact.path,
            parent_id=parent_id,
            evidence_ids=[],
        )
        modules.append(file_node)

        fact_module_to_file_node[fact.id] = file_node_id
        fact_module_to_group_node[fact.id] = deepest_group_id

    modules.extend(layer_nodes.values())
    modules.extend(group_nodes.values())

    ports: list[PortNode] = []
    for item in snapshot.interfaces:
        file_id = fact_module_to_file_node.get(item.module_id)
        if not file_id:
            continue
        ports.append(
            PortNode(
                id=item.id,
                module_id=file_id,
                name=item.name,
                protocol=item.protocol,
                direction=item.direction,
                details=item.details,
                evidence_ids=[item.evidence_id],
            )
        )

    edges: list[ArchitectureEdge] = []
    edge_seen: set[tuple[str, str, str, str]] = set()

    for item in snapshot.edges:
        src_file = fact_module_to_file_node.get(item.src_module_id)
        dst_file = fact_module_to_file_node.get(item.dst_module_id)
        if src_file and dst_file and src_file != dst_file:
            key = (src_file, dst_file, "dependency_file", item.label)
            if key not in edge_seen:
                edge_seen.add(key)
                edges.append(
                    ArchitectureEdge(
                        id=stable_id("edge", *key),
                        src_id=src_file,
                        dst_id=dst_file,
                        kind="dependency_file",
                        label=item.label,
                        evidence_ids=[item.evidence_id],
                    )
                )

        src_group = fact_module_to_group_node.get(item.src_module_id)
        dst_group = fact_module_to_group_node.get(item.dst_module_id)
        if src_group and dst_group and src_group != dst_group:
            key = (src_group, dst_group, "dependency", item.label)
            if key not in edge_seen:
                edge_seen.add(key)
                edges.append(
                    ArchitectureEdge(
                        id=stable_id("edge", *key),
                        src_id=src_group,
                        dst_id=dst_group,
                        kind="dependency",
                        label=item.label,
                        evidence_ids=[item.evidence_id],
                    )
                )

    in_ports_by_protocol: dict[str, list[PortNode]] = defaultdict(list)
    out_ports_by_protocol: dict[str, list[PortNode]] = defaultdict(list)
    for port in ports:
        direction = port.direction.lower()
        if direction == "in":
            in_ports_by_protocol[port.protocol].append(port)
        elif direction == "out":
            out_ports_by_protocol[port.protocol].append(port)

    for protocol, out_ports in out_ports_by_protocol.items():
        in_ports = in_ports_by_protocol.get(protocol, [])
        for out_port in out_ports:
            src_key = _route_key(out_port.name)
            for in_port in in_ports:
                if out_port.module_id == in_port.module_id:
                    continue
                dst_key = _route_key(in_port.name)
                if not _is_route_match(src_key, dst_key):
                    continue
                label = f"{protocol} {src_key}"
                key = (out_port.module_id, in_port.module_id, "interface", label)
                if key in edge_seen:
                    continue
                edge_seen.add(key)
                edges.append(
                    ArchitectureEdge(
                        id=stable_id("edge", *key),
                        src_id=out_port.module_id,
                        dst_id=in_port.module_id,
                        kind="interface",
                        label=label,
                        evidence_ids=[*out_port.evidence_ids, *in_port.evidence_ids],
                    )
                )

    provider = build_provider(rules.llm, llm_audit_dir)
    default_summaries = _build_default_summaries(modules=modules, ports=ports, edges=edges)

    enrichables = [
        ModuleDraft(id=node.id, name=node.name, layer=node.layer, path=node.path)
        for node in modules
        if node.level >= 1
    ]
    enrichment = provider.enrich(enrichables)

    merged_summaries = dict(default_summaries)
    summary_source = {module_id: "fallback" for module_id in default_summaries}
    for module_id, summary in enrichment.summaries.items():
        clean = summary.strip()
        if not clean:
            continue
        if not _contains_chinese(clean):
            continue
        merged_summaries[module_id] = clean
        summary_source[module_id] = "llm"

    metadata = {
        "snapshot_id": snapshot.snapshot_id,
        "module_count": len(modules),
        "port_count": len(ports),
        "edge_count": len(edges),
        "llm_summaries": merged_summaries,
        "llm_summary_source": summary_source,
        "coverage": snapshot.metadata.get("coverage", {}),
        "language_breakdown": snapshot.metadata.get("language_breakdown", {}),
    }

    renamed: list[ModuleNode] = []
    for node in modules:
        if node.id in enrichment.names:
            renamed.append(
                ModuleNode(
                    id=node.id,
                    name=enrichment.names[node.id],
                    layer=node.layer,
                    level=node.level,
                    path=node.path,
                    parent_id=node.parent_id,
                    evidence_ids=node.evidence_ids,
                )
            )
        else:
            renamed.append(node)

    return ArchitectureModel(
        system_name=rules.system_name,
        commit_id=snapshot.commit_id,
        generated_at=utc_now_iso(),
        modules=renamed,
        ports=ports,
        edges=edges,
        evidences=snapshot.evidences,
        metadata=metadata,
    )
