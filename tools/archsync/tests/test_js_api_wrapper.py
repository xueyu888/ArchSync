from __future__ import annotations

from pathlib import Path

from archsync.analyzers.engine import extract_facts
from archsync.config import RulesConfig


def test_extract_facts_detects_js_api_wrapper_interfaces(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    (repo / "frontend" / "src").mkdir(parents=True)
    (repo / "frontend" / "src" / "api.js").write_text(
        """async function apiGet(path) {\n  return fetch(path)\n}\n\nexport function load() {\n  return apiGet('/api/health')\n}\n""",
        encoding="utf-8",
    )

    rules = RulesConfig.default()
    snapshot = extract_facts(repo_root=repo, rules=rules, commit_id="js-wrapper")

    names = {(item.direction, item.protocol, item.name) for item in snapshot.interfaces}
    assert ("out", "HTTP", "GET /api/health") in names
