from __future__ import annotations

from pathlib import Path

from archsync.analyzers.engine import extract_facts
from archsync.config import RulesConfig


def test_extract_facts_resolves_python_src_layout_imports(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    (repo / "src" / "pkg").mkdir(parents=True)
    (repo / "src" / "pkg" / "__init__.py").write_text("", encoding="utf-8")
    (repo / "src" / "pkg" / "b.py").write_text("def hello():\n    return 'hi'\n", encoding="utf-8")
    (repo / "src" / "pkg" / "a.py").write_text(
        "from pkg.b import hello\n\n\ndef call():\n    return hello()\n",
        encoding="utf-8",
    )

    rules = RulesConfig.default()
    snapshot = extract_facts(repo_root=repo, rules=rules, commit_id="src-layout")

    module_names = {item.name for item in snapshot.modules}
    assert "pkg.a" in module_names
    assert "pkg.b" in module_names

    edge_labels = {item.label for item in snapshot.edges}
    assert "from pkg.b import hello" in edge_labels
