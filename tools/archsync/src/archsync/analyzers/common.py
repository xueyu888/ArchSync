from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from archsync.schemas import EdgeFact, Evidence, InterfaceFact, ModuleFact, SymbolFact


@dataclass(slots=True)
class AnalyzerContext:
    repo_root: Path
    module_by_relpath: dict[str, ModuleFact]
    python_name_to_module_id: dict[str, str]
    js_relpath_to_module_id: dict[str, str]


@dataclass(slots=True)
class AnalyzerResult:
    symbols: list[SymbolFact]
    interfaces: list[InterfaceFact]
    edges: list[EdgeFact]
    evidences: list[Evidence]

    @classmethod
    def empty(cls) -> AnalyzerResult:
        return cls(symbols=[], interfaces=[], edges=[], evidences=[])
