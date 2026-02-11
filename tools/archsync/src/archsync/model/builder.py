from __future__ import annotations

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


def _group_path(path: str, depth: int) -> str:
    parts = list(PurePosixPath(path).parts)
    if not parts:
        return path
    group_len = min(max(1, depth), max(1, len(parts) - 1))
    return "/".join(parts[:group_len])


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

    file_to_group: dict[str, str] = {}
    file_to_layer: dict[str, str] = {}
    fact_module_to_file_node: dict[str, str] = {}
    fact_module_to_group_node: dict[str, str] = {}

    layer_nodes: dict[str, ModuleNode] = {}
    group_nodes: dict[str, ModuleNode] = {}

    for fact in snapshot.modules:
        layer = _pick_layer(fact.path, rules)
        file_to_layer[fact.path] = layer

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

        group_path = _group_path(fact.path, rules.module_depth)
        group_id = stable_id("group", layer, group_path)
        if group_id not in group_nodes:
            group_nodes[group_id] = ModuleNode(
                id=group_id,
                name=group_path,
                layer=layer,
                level=2,
                path=group_path,
                parent_id=layer_nodes[layer].id,
                evidence_ids=[],
            )

        file_node_id = stable_id("file", fact.path)
        file_node = ModuleNode(
            id=file_node_id,
            name=fact.path,
            layer=layer,
            level=3,
            path=fact.path,
            parent_id=group_id,
            evidence_ids=[],
        )
        modules.append(file_node)

        fact_module_to_file_node[fact.id] = file_node_id
        fact_module_to_group_node[fact.id] = group_id
        file_to_group[fact.path] = group_id

    modules.extend(layer_nodes.values())
    modules.extend(group_nodes.values())

    ports: list[PortNode] = []
    for item in snapshot.interfaces:
        group_id = fact_module_to_group_node.get(item.module_id)
        if not group_id:
            continue
        ports.append(
            PortNode(
                id=item.id,
                module_id=group_id,
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
    enrichables = [
        ModuleDraft(id=node.id, name=node.name, layer=node.layer, path=node.path)
        for node in modules
        if node.level in {1, 2}
    ]
    enrichment = provider.enrich(enrichables)

    metadata = {
        "snapshot_id": snapshot.snapshot_id,
        "module_count": len(modules),
        "port_count": len(ports),
        "edge_count": len(edges),
        "llm_summaries": enrichment.summaries,
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
