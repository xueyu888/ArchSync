from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from archsync.analyzers.engine import extract_facts
from archsync.config import RulesConfig
from archsync.git_utils import current_commit
from archsync.model.builder import build_architecture_model
from archsync.render.renderer import render_outputs
from archsync.schemas import ArchitectureModel, FactsSnapshot
from archsync.storage.sqlite_store import SQLiteStore
from archsync.utils import write_json


@dataclass(slots=True)
class BuildResult:
    snapshot: FactsSnapshot
    model: ArchitectureModel
    outputs: dict[str, Path]


def run_build(
    repo_root: Path,
    rules: RulesConfig,
    output_dir: Path,
    state_db: Path,
    commit_id: str | None = None,
    full: bool = False,
    only_views: set[str] | None = None,
) -> BuildResult:
    commit = commit_id or current_commit(repo_root)

    snapshot = extract_facts(repo_root=repo_root, rules=rules, commit_id=commit)
    store = SQLiteStore(state_db)
    store.save_snapshot(snapshot)

    llm_audit_dir = state_db.parent / "llm_audit"
    model = build_architecture_model(snapshot=snapshot, rules=rules, llm_audit_dir=llm_audit_dir)

    outputs = render_outputs(
        model=model,
        rules=rules,
        output_dir=output_dir,
        full=full,
        only_views=only_views,
    )
    write_json(output_dir / "facts.snapshot.json", snapshot.to_dict())

    return BuildResult(snapshot=snapshot, model=model, outputs=outputs)
