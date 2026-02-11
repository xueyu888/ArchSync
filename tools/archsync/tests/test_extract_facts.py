from pathlib import Path

from archsync.analyzers.engine import extract_facts
from archsync.config import RulesConfig


def test_extract_facts_detects_modules_edges_and_interfaces() -> None:
    repo = Path(__file__).parent / "fixtures" / "sample_repo"
    rules = RulesConfig.default()

    snapshot = extract_facts(repo_root=repo, rules=rules, commit_id="test")

    paths = {item.path for item in snapshot.modules}
    assert "backend/app.py" in paths
    assert "frontend/src/api.js" in paths

    interfaces = {(item.module_id, item.direction, item.protocol, item.name) for item in snapshot.interfaces}
    assert any(direction == "in" and protocol == "HTTP" and "/api/users" in name for _, direction, protocol, name in interfaces)
    assert any(direction == "out" and protocol == "HTTP" and "/api/users" in name for _, direction, protocol, name in interfaces)

    edge_labels = {item.label for item in snapshot.edges}
    assert any("import ./api" in label for label in edge_labels)

    coverage = snapshot.metadata.get("coverage", {})
    assert coverage.get("analyzed_files", 0) > 0
    assert coverage.get("eligible_files", 0) >= coverage.get("analyzed_files", 0)
    assert float(coverage.get("coverage_ratio", 0)) > 0
