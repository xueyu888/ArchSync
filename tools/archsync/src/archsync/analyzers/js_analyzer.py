from __future__ import annotations

import re
from pathlib import Path, PurePosixPath

from archsync.analyzers.common import AnalyzerContext, AnalyzerResult
from archsync.schemas import EdgeFact, Evidence, InterfaceFact, ModuleFact, SymbolFact
from archsync.utils import sanitize_label, stable_id

IMPORT_RE = re.compile(r"^\s*import\s+.*?from\s+['\"]([^'\"]+)['\"]")
IMPORT_SIDE_EFFECT_RE = re.compile(r"^\s*import\s+['\"]([^'\"]+)['\"]")
REQUIRE_RE = re.compile(r"require\(\s*['\"]([^'\"]+)['\"]\s*\)")
EXPORT_RE = re.compile(r"^\s*export\s+(?:default\s+)?(?:class|function|const|let|var)\s+([A-Za-z0-9_$]+)")
ROUTE_RE = re.compile(r"(?:app|router)\.(get|post|put|delete|patch)\(\s*['\"]([^'\"]+)['\"]")
FETCH_RE = re.compile(r"fetch\(\s*['\"]([^'\"]+)['\"]")
AXIOS_RE = re.compile(r"axios\.(get|post|put|delete|patch)\(\s*['\"]([^'\"]+)['\"]")
API_WRAPPER_RE = re.compile(r"\b(apiGet|apiPost|apiPut|apiDelete|apiPatch)\(\s*['\"]([^'\"]+)['\"]")


def _normalize_relpath(value: str) -> str:
    return str(PurePosixPath(value))


def _resolve_js_import(spec: str, rel_path: str, context: AnalyzerContext) -> str | None:
    if spec.startswith("."):
        base = PurePosixPath(rel_path).parent
        candidate = _normalize_relpath(str(base.joinpath(spec)))
        candidates = [
            candidate,
            f"{candidate}.js",
            f"{candidate}.jsx",
            f"{candidate}.ts",
            f"{candidate}.tsx",
            f"{candidate}/index.js",
            f"{candidate}/index.jsx",
            f"{candidate}/index.ts",
            f"{candidate}/index.tsx",
        ]
        for item in candidates:
            module_id = context.js_relpath_to_module_id.get(_normalize_relpath(item))
            if module_id:
                return module_id
        return None

    for path, module_id in context.js_relpath_to_module_id.items():
        if path.endswith(spec) or path.endswith(f"{spec}.js"):
            return module_id
    return None


def analyze_js_file(
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

    def wrapper_method(name: str) -> str:
        suffix = name.lower().replace("api", "")
        return suffix.upper() if suffix in {"get", "post", "put", "delete", "patch"} else "HTTP"

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

    def add_dependency(line_no: int, target_module_id: str, label: str, kind: str = "dependency") -> None:
        if target_module_id == module.id:
            return
        key = (module.id, target_module_id, kind, label)
        if key in edge_seen:
            return
        edge_seen.add(key)
        evidence = add_evidence(line_no, "js-regex")
        edge_id = stable_id(module.id, target_module_id, label, evidence.id)
        edges.append(
            EdgeFact(
                id=edge_id,
                src_module_id=module.id,
                dst_module_id=target_module_id,
                kind=kind,
                label=sanitize_label(label),
                evidence_id=evidence.id,
            )
        )

    def add_symbol(line_no: int, name: str, kind: str = "export") -> None:
        evidence = add_evidence(line_no, "js-regex")
        symbol_id = stable_id(module.id, name, kind, evidence.id)
        symbols.append(
            SymbolFact(
                id=symbol_id,
                module_id=module.id,
                name=name,
                kind=kind,
                visibility="public",
                line=line_no,
            )
        )

    def add_interface(line_no: int, name: str, protocol: str, direction: str, details: str) -> None:
        evidence = add_evidence(line_no, "js-regex")
        interface_id = stable_id(module.id, name, direction, evidence.id)
        interfaces.append(
            InterfaceFact(
                id=interface_id,
                module_id=module.id,
                name=sanitize_label(name),
                protocol=protocol,
                direction=direction,
                details=sanitize_label(details),
                evidence_id=evidence.id,
            )
        )

    for idx, line in enumerate(lines, start=1):
        for regex in (IMPORT_RE, IMPORT_SIDE_EFFECT_RE):
            match = regex.search(line)
            if match:
                spec = match.group(1)
                target = _resolve_js_import(spec, rel_path, context)
                if target:
                    add_dependency(idx, target, f"import {spec}")

        for match in REQUIRE_RE.finditer(line):
            spec = match.group(1)
            target = _resolve_js_import(spec, rel_path, context)
            if target:
                add_dependency(idx, target, f"require {spec}")

        export_match = EXPORT_RE.search(line)
        if export_match:
            add_symbol(idx, export_match.group(1))

        route_match = ROUTE_RE.search(line)
        if route_match:
            method = route_match.group(1).upper()
            route = route_match.group(2)
            add_interface(idx, f"{method} {route}", "HTTP", "in", "javascript route")

        fetch_match = FETCH_RE.search(line)
        if fetch_match:
            route = fetch_match.group(1)
            add_interface(idx, f"HTTP {route}", "HTTP", "out", "fetch call")

        axios_match = AXIOS_RE.search(line)
        if axios_match:
            method = axios_match.group(1).upper()
            route = axios_match.group(2)
            add_interface(idx, f"{method} {route}", "HTTP", "out", "axios call")

        wrapper_match = API_WRAPPER_RE.search(line)
        if wrapper_match:
            method = wrapper_method(wrapper_match.group(1))
            route = wrapper_match.group(2)
            add_interface(idx, f"{method} {route}", "HTTP", "out", "api wrapper call")

    return AnalyzerResult(symbols=symbols, interfaces=interfaces, edges=edges, evidences=evidences)
