from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from hashlib import sha1
from typing import Any


class Serializable:
    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class Evidence(Serializable):
    id: str
    file_path: str
    line_start: int
    line_end: int
    parser: str


@dataclass(slots=True)
class ModuleFact(Serializable):
    id: str
    name: str
    path: str
    language: str


@dataclass(slots=True)
class SymbolFact(Serializable):
    id: str
    module_id: str
    name: str
    kind: str
    visibility: str
    line: int


@dataclass(slots=True)
class InterfaceFact(Serializable):
    id: str
    module_id: str
    name: str
    protocol: str
    direction: str
    details: str
    evidence_id: str


@dataclass(slots=True)
class EdgeFact(Serializable):
    id: str
    src_module_id: str
    dst_module_id: str
    kind: str
    label: str
    evidence_id: str
    interface_id: str | None = None


@dataclass(slots=True)
class FactsSnapshot(Serializable):
    snapshot_id: str
    commit_id: str
    repo_root: str
    created_at: str
    modules: list[ModuleFact] = field(default_factory=list)
    symbols: list[SymbolFact] = field(default_factory=list)
    interfaces: list[InterfaceFact] = field(default_factory=list)
    edges: list[EdgeFact] = field(default_factory=list)
    evidences: list[Evidence] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def create(cls, commit_id: str, repo_root: str) -> FactsSnapshot:
        created_at = datetime.now(UTC).isoformat()
        seed = f"{commit_id}|{repo_root}|{created_at}".encode()
        snapshot_id = sha1(seed).hexdigest()[:16]
        return cls(
            snapshot_id=snapshot_id,
            commit_id=commit_id,
            repo_root=repo_root,
            created_at=created_at,
        )


@dataclass(slots=True)
class ModuleNode(Serializable):
    id: str
    name: str
    layer: str
    level: int
    path: str
    parent_id: str | None
    evidence_ids: list[str] = field(default_factory=list)


@dataclass(slots=True)
class PortNode(Serializable):
    id: str
    module_id: str
    name: str
    protocol: str
    direction: str
    details: str
    evidence_ids: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ArchitectureEdge(Serializable):
    id: str
    src_id: str
    dst_id: str
    kind: str
    label: str
    evidence_ids: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ArchitectureModel(Serializable):
    system_name: str
    commit_id: str
    generated_at: str
    modules: list[ModuleNode]
    ports: list[PortNode]
    edges: list[ArchitectureEdge]
    evidences: list[Evidence]
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class LayerViolation(Serializable):
    rule: str
    src_module: str
    dst_module: str
    severity: str
    details: str


@dataclass(slots=True)
class DiffReport(Serializable):
    base_commit: str
    head_commit: str
    generated_at: str
    added_modules: list[str] = field(default_factory=list)
    removed_modules: list[str] = field(default_factory=list)
    added_ports: list[str] = field(default_factory=list)
    removed_ports: list[str] = field(default_factory=list)
    added_edges: list[str] = field(default_factory=list)
    removed_edges: list[str] = field(default_factory=list)
    api_surface_changes: list[str] = field(default_factory=list)
    violations: list[LayerViolation] = field(default_factory=list)
    cycles: list[list[str]] = field(default_factory=list)
    changed_files: list[str] = field(default_factory=list)

    @property
    def has_blocking_issues(self) -> bool:
        return any(v.severity in {"high", "critical"} for v in self.violations) or bool(self.cycles)
