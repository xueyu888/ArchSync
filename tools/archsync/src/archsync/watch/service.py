from __future__ import annotations

import time
from pathlib import Path

from archsync.analyzers.engine import discover_source_files
from archsync.config import RulesConfig
from archsync.pipeline import run_build


def _fingerprint(repo_root: Path, files: list[str]) -> dict[str, float]:
    output: dict[str, float] = {}
    for rel in files:
        path = repo_root / rel
        if not path.exists():
            continue
        output[rel] = path.stat().st_mtime
    return output


def watch_loop(
    repo_root: Path,
    rules: RulesConfig,
    output_dir: Path,
    state_db: Path,
    interval_seconds: float = 1.5,
) -> None:
    files = discover_source_files(repo_root, rules)
    baseline = _fingerprint(repo_root, files)
    run_build(repo_root=repo_root, rules=rules, output_dir=output_dir, state_db=state_db)
    print(f"[archsync] watch started. monitoring {len(files)} files")

    while True:
        time.sleep(interval_seconds)
        files = discover_source_files(repo_root, rules)
        current = _fingerprint(repo_root, files)
        if current == baseline:
            continue
        changed = sorted(
            set(current).union(baseline)
            - {path for path in set(current).intersection(baseline) if current[path] == baseline[path]}
        )
        baseline = current
        run_build(repo_root=repo_root, rules=rules, output_dir=output_dir, state_db=state_db)
        print(f"[archsync] rebuilt due to changes: {', '.join(changed[:8])}{'...' if len(changed) > 8 else ''}")
