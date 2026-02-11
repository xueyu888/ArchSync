from __future__ import annotations

from archsync.config import RulesConfig
from archsync.diff.rules_engine import detect_cycles, detect_violations
from archsync.schemas import ArchitectureModel, DiffReport
from archsync.utils import utc_now_iso


def _module_signatures(model: ArchitectureModel) -> set[str]:
    return {
        f"{item.layer}:{item.path}"
        for item in model.modules
        if item.level >= 1 and not item.id.startswith("system:")
    }


def _port_signatures(model: ArchitectureModel, module_lookup: dict[str, str]) -> set[str]:
    signatures: set[str] = set()
    for port in model.ports:
        module_name = module_lookup.get(port.module_id, port.module_id)
        signatures.add(f"{module_name}:{port.direction}:{port.protocol}:{port.name}")
    return signatures


def _port_index(model: ArchitectureModel, module_lookup: dict[str, str]) -> dict[str, tuple[str, str, str]]:
    index: dict[str, tuple[str, str, str]] = {}
    for port in model.ports:
        module_name = module_lookup.get(port.module_id, port.module_id)
        key = f"{module_name}:{port.name}"
        index[key] = (port.direction, port.protocol, port.details)
    return index


def _edge_signatures(model: ArchitectureModel, module_lookup: dict[str, str]) -> set[str]:
    signatures: set[str] = set()
    for edge in model.edges:
        src_name = module_lookup.get(edge.src_id, edge.src_id)
        dst_name = module_lookup.get(edge.dst_id, edge.dst_id)
        signatures.add(f"{edge.kind}:{src_name}->{dst_name}:{edge.label}")
    return signatures


def build_diff_report(
    base_model: ArchitectureModel,
    head_model: ArchitectureModel,
    rules: RulesConfig,
    changed_files: list[str] | None = None,
) -> DiffReport:
    changed_files = changed_files or []
    base_modules = _module_signatures(base_model)
    head_modules = _module_signatures(head_model)

    base_lookup = {item.id: f"{item.layer}:{item.path}" for item in base_model.modules}
    head_lookup = {item.id: f"{item.layer}:{item.path}" for item in head_model.modules}

    base_ports = _port_signatures(base_model, base_lookup)
    head_ports = _port_signatures(head_model, head_lookup)
    base_port_index = _port_index(base_model, base_lookup)
    head_port_index = _port_index(head_model, head_lookup)

    base_edges = _edge_signatures(base_model, base_lookup)
    head_edges = _edge_signatures(head_model, head_lookup)

    api_surface_changes: list[str] = []
    for key in sorted(set(base_port_index).union(head_port_index)):
        before = base_port_index.get(key)
        after = head_port_index.get(key)
        if before == after:
            continue
        if before is None and after is not None:
            api_surface_changes.append(
                f"API added {key}: dir={after[0]} protocol={after[1]} details={after[2]}"
            )
            continue
        if before is not None and after is None:
            api_surface_changes.append(
                f"API removed {key}: dir={before[0]} protocol={before[1]} details={before[2]}"
            )
            continue
        if before is not None and after is not None:
            api_surface_changes.append(
                f"API changed {key}: {before[0]}/{before[1]} -> {after[0]}/{after[1]}"
            )

    violations = detect_violations(head_model, rules)
    cycles = detect_cycles(head_model)

    return DiffReport(
        base_commit=base_model.commit_id,
        head_commit=head_model.commit_id,
        generated_at=utc_now_iso(),
        added_modules=sorted(head_modules - base_modules),
        removed_modules=sorted(base_modules - head_modules),
        added_ports=sorted(head_ports - base_ports),
        removed_ports=sorted(base_ports - head_ports),
        added_edges=sorted(head_edges - base_edges),
        removed_edges=sorted(base_edges - head_edges),
        api_surface_changes=api_surface_changes,
        violations=violations,
        cycles=cycles,
        changed_files=sorted(changed_files),
    )
