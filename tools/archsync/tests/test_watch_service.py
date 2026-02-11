from archsync.schemas import ArchitectureEdge, ArchitectureModel, ModuleNode
from archsync.watch.service import _impacted_views


def _model(edge_kind: str = "dependency") -> ArchitectureModel:
    modules = [
        ModuleNode(id="system:x", name="x", layer="System", level=0, path="/", parent_id=None),
        ModuleNode(id="layer:A", name="A", layer="A", level=1, path="A", parent_id="system:x"),
        ModuleNode(id="layer:B", name="B", layer="B", level=1, path="B", parent_id="system:x"),
        ModuleNode(id="mod:a", name="a", layer="A", level=2, path="a", parent_id="layer:A"),
        ModuleNode(id="mod:b", name="b", layer="B", level=2, path="b", parent_id="layer:B"),
        ModuleNode(id="file:a", name="a.py", layer="A", level=3, path="a.py", parent_id="mod:a"),
        ModuleNode(id="file:b", name="b.py", layer="B", level=3, path="b.py", parent_id="mod:b"),
    ]
    edges = [
        ArchitectureEdge(id="e1", src_id="mod:a", dst_id="mod:b", kind="dependency", label="dep"),
        ArchitectureEdge(id="e2", src_id="file:a", dst_id="file:b", kind=edge_kind, label="file dep"),
    ]
    return ArchitectureModel(
        system_name="x",
        commit_id="head",
        generated_at="now",
        modules=modules,
        ports=[],
        edges=edges,
        evidences=[],
    )


def test_impacted_views_detects_l2_only_change() -> None:
    previous = _model(edge_kind="dependency_file")
    current = _model(edge_kind="dependency_file")

    impacted = _impacted_views(previous, current)
    assert impacted == {"l2"}


def test_impacted_views_detects_l1_change() -> None:
    previous = _model(edge_kind="dependency_file")
    current = _model(edge_kind="dependency")

    impacted = _impacted_views(previous, current)
    assert "l1" in impacted
