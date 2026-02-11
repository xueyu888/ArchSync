from __future__ import annotations

import time
from pathlib import Path

from archsync.analyzers.engine import discover_source_files
from archsync.config import RulesConfig
from archsync.pipeline import run_build
from archsync.schemas import ArchitectureModel


def _fingerprint(repo_root: Path, files: list[str]) -> dict[str, float]:
    output: dict[str, float] = {}
    for rel in files:
        path = repo_root / rel
        if not path.exists():
            continue
        output[rel] = path.stat().st_mtime
    return output


def _module_lookup(model: ArchitectureModel) -> dict[str, tuple[int, str, str | None]]:
    return {item.id: (item.level, item.layer, item.parent_id) for item in model.modules}


def _ancestor(module_id: str, target_level: int, lookup: dict[str, tuple[int, str, str | None]]) -> str | None:
    current = module_id
    while current in lookup:
        level, _, parent = lookup[current]
        if level == target_level:
            return current
        if not parent:
            return None
        current = parent
    return None


def _layer_signature(model: ArchitectureModel) -> set[str]:
    return {f"module:{item.id}:{item.name}" for item in model.modules if item.level == 1}


def _l1_signature(model: ArchitectureModel) -> set[str]:
    lookup = _module_lookup(model)
    signatures = {f"module:{item.id}:{item.name}" for item in model.modules if item.level == 2}

    for edge in model.edges:
        if edge.kind not in {"dependency", "interface"}:
            continue
        src = _ancestor(edge.src_id, 2, lookup)
        dst = _ancestor(edge.dst_id, 2, lookup)
        if not src or not dst or src == dst:
            continue
        signatures.add(f"edge:{edge.kind}:{src}->{dst}:{edge.label}")
    return signatures


def _l2_signature(model: ArchitectureModel) -> set[str]:
    signatures = {f"module:{item.id}:{item.name}" for item in model.modules if item.level == 3}
    for edge in model.edges:
        if edge.kind != "dependency_file":
            continue
        signatures.add(f"edge:{edge.src_id}->{edge.dst_id}:{edge.label}")
    return signatures


def _impacted_views(previous: ArchitectureModel | None, current: ArchitectureModel) -> set[str]:
    if previous is None:
        return {"l0", "l1", "l2"}

    impacted: set[str] = set()
    if _layer_signature(previous) != _layer_signature(current):
        impacted.add("l0")

    if _l1_signature(previous) != _l1_signature(current):
        impacted.add("l1")

    if _l2_signature(previous) != _l2_signature(current):
        impacted.add("l2")

    if not impacted:
        impacted.add("l2")
    return impacted


def watch_loop(
    repo_root: Path,
    rules: RulesConfig,
    output_dir: Path,
    state_db: Path,
    interval_seconds: float = 1.5,
) -> None:
    files = discover_source_files(repo_root, rules)
    baseline = _fingerprint(repo_root, files)

    initial = run_build(
        repo_root=repo_root,
        rules=rules,
        output_dir=output_dir,
        state_db=state_db,
        full=True,
    )
    previous_model = initial.model
    print(f"[archsync] watch started. monitoring {len(files)} files")

    while True:
        time.sleep(interval_seconds)
        files = discover_source_files(repo_root, rules)
        current = _fingerprint(repo_root, files)
        if current == baseline:
            continue

        unchanged = {
            path
            for path in set(current).intersection(baseline)
            if current[path] == baseline[path]
        }
        changed = sorted(set(current).union(baseline) - unchanged)
        baseline = current

        probe = run_build(
            repo_root=repo_root,
            rules=rules,
            output_dir=output_dir,
            state_db=state_db,
            full=True,
        )
        impacted = _impacted_views(previous_model, probe.model)

        if impacted != {"l0", "l1", "l2"}:
            incremental = run_build(
                repo_root=repo_root,
                rules=rules,
                output_dir=output_dir,
                state_db=state_db,
                full=True,
                only_views=impacted,
            )
            previous_model = incremental.model
        else:
            previous_model = probe.model

        sample = ", ".join(changed[:8])
        suffix = "..." if len(changed) > 8 else ""
        print(
            "[archsync] rebuilt due to changes: "
            f"{sample}{suffix} | impacted views: {','.join(sorted(impacted))}"
        )
