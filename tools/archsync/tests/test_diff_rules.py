from archsync.config import RulesConfig
from archsync.diff.rules_engine import detect_cycles, detect_violations
from archsync.schemas import ArchitectureEdge, ArchitectureModel, ModuleNode


def _model_with_cycle() -> ArchitectureModel:
    modules = [
        ModuleNode(id="system:x", name="x", layer="System", level=0, path="/", parent_id=None),
        ModuleNode(id="layer:Frontend", name="Frontend", layer="Frontend", level=1, path="Frontend", parent_id="system:x"),
        ModuleNode(id="layer:Backend", name="Backend", layer="Backend", level=1, path="Backend", parent_id="system:x"),
        ModuleNode(id="m1", name="frontend/src", layer="Frontend", level=2, path="frontend/src", parent_id="layer:Frontend"),
        ModuleNode(id="m2", name="backend", layer="Backend", level=2, path="backend", parent_id="layer:Backend"),
    ]
    edges = [
        ArchitectureEdge(id="e1", src_id="m2", dst_id="m1", kind="dependency", label="bad"),
        ArchitectureEdge(id="e2", src_id="m1", dst_id="m2", kind="dependency", label="ok"),
    ]
    return ArchitectureModel(
        system_name="x",
        commit_id="h",
        generated_at="now",
        modules=modules,
        ports=[],
        edges=edges,
        evidences=[],
    )


def test_rules_engine_detects_violation_and_cycle() -> None:
    model = _model_with_cycle()
    rules = RulesConfig.default()

    violations = detect_violations(model, rules)
    assert any(item.rule == "forbidden_dependency" for item in violations)

    cycles = detect_cycles(model)
    assert cycles
