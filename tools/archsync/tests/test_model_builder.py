from pathlib import Path

from archsync.analyzers.engine import extract_facts
from archsync.config import RulesConfig
from archsync.model.builder import build_architecture_model


def test_model_builder_creates_layers_ports_and_interface_edges(tmp_path) -> None:
    repo = Path(__file__).parent / "fixtures" / "sample_repo"
    rules = RulesConfig.default()

    snapshot = extract_facts(repo_root=repo, rules=rules, commit_id="test")
    model = build_architecture_model(snapshot=snapshot, rules=rules, llm_audit_dir=tmp_path / "llm")

    assert any(item.level == 1 and item.name == "Frontend" for item in model.modules)
    assert any(item.level == 1 and item.name == "Backend" for item in model.modules)
    assert any(item.protocol == "HTTP" for item in model.ports)
    assert any(item.kind == "interface" for item in model.edges)
