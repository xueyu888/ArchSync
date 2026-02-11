from __future__ import annotations

from collections import defaultdict
from fnmatch import fnmatch

from archsync.config import RulesConfig
from archsync.schemas import ArchitectureModel, LayerViolation


def _module_lookup(model: ArchitectureModel) -> dict[str, tuple[str, str, int]]:
    # module_id -> (name, layer, level)
    return {item.id: (item.name, item.layer, item.level) for item in model.modules}


def _matches(pattern: str, name: str, layer: str) -> bool:
    return fnmatch(name, pattern) or fnmatch(layer, pattern)


def detect_violations(model: ArchitectureModel, rules: RulesConfig) -> list[LayerViolation]:
    lookup = _module_lookup(model)
    violations: list[LayerViolation] = []

    order_index = {name: idx for idx, name in enumerate(rules.constraints.layer_order)}

    for edge in model.edges:
        if edge.kind not in {"dependency", "interface"}:
            continue
        src_meta = lookup.get(edge.src_id)
        dst_meta = lookup.get(edge.dst_id)
        if not src_meta or not dst_meta:
            continue
        src_name, src_layer, _ = src_meta
        dst_name, dst_layer, _ = dst_meta

        if src_layer in order_index and dst_layer in order_index:
            if order_index[src_layer] > order_index[dst_layer]:
                violations.append(
                    LayerViolation(
                        rule="layer_order",
                        src_module=src_name,
                        dst_module=dst_name,
                        severity="medium",
                        details=f"{src_layer} -> {dst_layer} violates order {rules.constraints.layer_order}",
                    )
                )

        for forbidden in rules.constraints.forbidden_dependencies:
            if _matches(forbidden.from_value, src_name, src_layer) and _matches(
                forbidden.to_value, dst_name, dst_layer
            ):
                violations.append(
                    LayerViolation(
                        rule="forbidden_dependency",
                        src_module=src_name,
                        dst_module=dst_name,
                        severity=forbidden.severity,
                        details=f"Forbidden by rule {forbidden.from_value} -> {forbidden.to_value}",
                    )
                )

    return _dedupe_violations(violations)


def detect_cycles(model: ArchitectureModel) -> list[list[str]]:
    lookup = _module_lookup(model)
    graph: dict[str, list[str]] = defaultdict(list)
    for edge in model.edges:
        if edge.kind not in {"dependency", "interface"}:
            continue
        src_meta = lookup.get(edge.src_id)
        dst_meta = lookup.get(edge.dst_id)
        if not src_meta or not dst_meta:
            continue
        # focus on level2 logical modules
        if src_meta[2] != 2 or dst_meta[2] != 2:
            continue
        graph[edge.src_id].append(edge.dst_id)

    visited: set[str] = set()
    stack: set[str] = set()
    path: list[str] = []
    cycles: list[list[str]] = []

    def dfs(node: str) -> None:
        visited.add(node)
        stack.add(node)
        path.append(node)

        for nxt in graph.get(node, []):
            if nxt not in visited:
                dfs(nxt)
            elif nxt in stack:
                try:
                    index = path.index(nxt)
                except ValueError:
                    index = 0
                cycle = path[index:] + [nxt]
                names = [lookup[item][0] for item in cycle if item in lookup]
                if names and names not in cycles:
                    cycles.append(names)

        stack.remove(node)
        path.pop()

    for node in graph:
        if node not in visited:
            dfs(node)

    return cycles


def _dedupe_violations(items: list[LayerViolation]) -> list[LayerViolation]:
    result: list[LayerViolation] = []
    seen: set[tuple[str, str, str, str]] = set()
    for item in items:
        key = (item.rule, item.src_module, item.dst_module, item.details)
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result
