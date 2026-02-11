import shutil
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


def test_model_builder_supports_deep_drill_hierarchy(tmp_path) -> None:
    fixture = Path(__file__).parent / "fixtures" / "sample_repo"
    repo = tmp_path / "repo"
    shutil.copytree(fixture, repo)

    nested_file = repo / "backend" / "nested" / "service" / "core.py"
    nested_file.parent.mkdir(parents=True, exist_ok=True)
    nested_file.write_text("def ping():\n    return 'ok'\n", encoding="utf-8")

    rules = RulesConfig.default()
    snapshot = extract_facts(repo_root=repo, rules=rules, commit_id="deep")
    model = build_architecture_model(snapshot=snapshot, rules=rules, llm_audit_dir=tmp_path / "llm")

    deep_group = next((item for item in model.modules if item.path == "backend/nested/service"), None)
    assert deep_group is not None

    deep_file = next((item for item in model.modules if item.path == "backend/nested/service/core.py"), None)
    assert deep_file is not None
    assert deep_file.parent_id == deep_group.id
    assert deep_file.level == deep_group.level + 1


def test_model_builder_generates_chinese_summary_for_every_module(tmp_path) -> None:
    repo = Path(__file__).parent / "fixtures" / "sample_repo"
    rules = RulesConfig.default()

    snapshot = extract_facts(repo_root=repo, rules=rules, commit_id="summary")
    model = build_architecture_model(snapshot=snapshot, rules=rules, llm_audit_dir=tmp_path / "llm")

    summaries = model.metadata.get("llm_summaries", {})
    summary_source = model.metadata.get("llm_summary_source", {})

    assert summaries
    assert len(summaries) == len(model.modules)
    assert len(summary_source) == len(model.modules)

    for module in model.modules:
        text = summaries.get(module.id, "")
        assert isinstance(text, str) and text.strip()
        assert any("\u4e00" <= ch <= "\u9fff" for ch in text)
