from __future__ import annotations

import re
from pathlib import Path, PurePosixPath

from archsync.analyzers.common import AnalyzerContext, AnalyzerResult
from archsync.schemas import EdgeFact, Evidence, InterfaceFact, ModuleFact, SymbolFact
from archsync.utils import sanitize_label, stable_id

INCLUDE_RE = re.compile(r'^\s*#include\s+["<]([^">]+)[">]')
FUNC_RE = re.compile(
    r"^\s*(?:[A-Za-z_][\w:<>,\s*&]+)\s+([A-Za-z_][\w:]*)\s*\([^;]*\)\s*(?:const\s*)?\{"
)


def _normalize(path: str) -> str:
    return str(PurePosixPath(path))


def _resolve_include(spec: str, rel_path: str, context: AnalyzerContext) -> str | None:
    if spec.startswith("."):
        base = PurePosixPath(rel_path).parent
        candidate = _normalize(str(base.joinpath(spec)))
    else:
        candidate = _normalize(spec)

    candidates = [
        candidate,
        f"{candidate}.h",
        f"{candidate}.hpp",
        f"{candidate}.hh",
        f"{candidate}.c",
        f"{candidate}.cc",
        f"{candidate}.cpp",
    ]

    for item in candidates:
        module = context.module_by_relpath.get(item)
        if module:
            return module.id

    # fallback suffix match
    for rel, module in context.module_by_relpath.items():
        if rel.endswith(candidate):
            return module.id
    return None


def analyze_cpp_file(
    file_path: Path,
    rel_path: str,
    module: ModuleFact,
    context: AnalyzerContext,
) -> AnalyzerResult:
    try:
        source = file_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return AnalyzerResult.empty()

    symbols: list[SymbolFact] = []
    interfaces: list[InterfaceFact] = []
    edges: list[EdgeFact] = []
    evidences: list[Evidence] = []
    edge_seen: set[tuple[str, str, str, str]] = set()

    lines = source.splitlines()

    def add_evidence(line_no: int, parser: str) -> Evidence:
        evidence_id = stable_id(rel_path, str(line_no), parser)
        evidence = Evidence(
            id=evidence_id,
            file_path=rel_path,
            line_start=line_no,
            line_end=line_no,
            parser=parser,
        )
        evidences.append(evidence)
        return evidence

    def add_edge(line_no: int, dst_module_id: str, label: str) -> None:
        if dst_module_id == module.id:
            return
        key = (module.id, dst_module_id, "dependency", label)
        if key in edge_seen:
            return
        edge_seen.add(key)
        evidence = add_evidence(line_no, "cpp-regex")
        edges.append(
            EdgeFact(
                id=stable_id(module.id, dst_module_id, label, evidence.id),
                src_module_id=module.id,
                dst_module_id=dst_module_id,
                kind="dependency",
                label=sanitize_label(label),
                evidence_id=evidence.id,
            )
        )

    def add_symbol(line_no: int, name: str) -> None:
        evidence = add_evidence(line_no, "cpp-regex")
        symbols.append(
            SymbolFact(
                id=stable_id(module.id, name, "function", evidence.id),
                module_id=module.id,
                name=name,
                kind="function",
                visibility="public",
                line=line_no,
            )
        )

    def add_interface(line_no: int, name: str, protocol: str) -> None:
        evidence = add_evidence(line_no, "cpp-regex")
        interfaces.append(
            InterfaceFact(
                id=stable_id(module.id, name, protocol, evidence.id),
                module_id=module.id,
                name=name,
                protocol=protocol,
                direction="bidir",
                details=f"Detected protocol keyword: {protocol}",
                evidence_id=evidence.id,
            )
        )

    for line_no, line in enumerate(lines, start=1):
        include_match = INCLUDE_RE.search(line)
        if include_match:
            spec = include_match.group(1)
            target = _resolve_include(spec, rel_path, context)
            if target:
                add_edge(line_no, target, f"include {spec}")

        func_match = FUNC_RE.search(line)
        if func_match:
            add_symbol(line_no, func_match.group(1))

        upper_line = line.upper()
        if "AXI" in upper_line:
            add_interface(line_no, "AXI interface", "AXI")
        if "I2C" in upper_line:
            add_interface(line_no, "I2C interface", "I2C")
        if "SPI" in upper_line:
            add_interface(line_no, "SPI interface", "SPI")
        if "UART" in upper_line:
            add_interface(line_no, "UART interface", "UART")

    return AnalyzerResult(symbols=symbols, interfaces=interfaces, edges=edges, evidences=evidences)
