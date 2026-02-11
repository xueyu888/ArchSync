from archsync.config import RulesConfig
from archsync.diff.engine import build_diff_report
from archsync.schemas import ArchitectureModel, ModuleNode, PortNode


def _model(port_protocol: str) -> ArchitectureModel:
    modules = [
        ModuleNode(id="system:x", name="x", layer="System", level=0, path="/", parent_id=None),
        ModuleNode(
            id="layer:Backend",
            name="Backend",
            layer="Backend",
            level=1,
            path="backend",
            parent_id="system:x",
        ),
        ModuleNode(
            id="mod:backend",
            name="backend",
            layer="Backend",
            level=2,
            path="backend",
            parent_id="layer:Backend",
        ),
    ]
    ports = [
        PortNode(
            id="p1",
            module_id="mod:backend",
            name="GET /api/users",
            protocol=port_protocol,
            direction="in",
            details="route",
            evidence_ids=[],
        )
    ]
    return ArchitectureModel(
        system_name="x",
        commit_id="c",
        generated_at="now",
        modules=modules,
        ports=ports,
        edges=[],
        evidences=[],
    )


def test_diff_report_contains_api_surface_changes() -> None:
    base = _model("HTTP")
    head = _model("gRPC")
    rules = RulesConfig.default()

    report = build_diff_report(base, head, rules)
    assert report.api_surface_changes
    assert "API changed" in report.api_surface_changes[0]
