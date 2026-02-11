from pathlib import Path

from archsync.analyzers.engine import extract_facts
from archsync.config import RulesConfig


def test_cpp_extraction_supports_include_edges_and_protocol_interfaces() -> None:
    repo = Path(__file__).parent / "fixtures" / "cpp_repo"
    rules = RulesConfig.from_dict(
        {
            "system_name": "CPP Repo",
            "module_depth": 2,
            "include": ["src/**/*.{c,cc,cpp,h,hpp,hh}", "src/*.{c,cc,cpp,h,hpp,hh}"],
            "exclude": [],
            "layers": [{"name": "Firmware", "match": ["src/**"]}],
            "default_layer": "Misc",
            "interfaces": [],
            "constraints": {"layer_order": ["Firmware", "Misc"], "forbidden_dependencies": []},
            "llm": {"enabled": False},
        }
    )

    snapshot = extract_facts(repo_root=repo, rules=rules, commit_id="cpp")

    paths = {item.path for item in snapshot.modules}
    assert "src/main.cpp" in paths
    assert "src/bus.hpp" in paths

    assert any(item.label.startswith("include bus.hpp") for item in snapshot.edges)
    assert any(item.protocol == "AXI" for item in snapshot.interfaces)
