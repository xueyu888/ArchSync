from __future__ import annotations

import ast
from pathlib import Path

from archsync.analyzers.common import AnalyzerContext, AnalyzerResult
from archsync.schemas import EdgeFact, Evidence, InterfaceFact, ModuleFact, SymbolFact
from archsync.utils import sanitize_label, stable_id

HTTP_METHODS = {"get", "post", "put", "delete", "patch", "websocket"}


def _resolve_python_module(candidate: str, lookup: dict[str, str]) -> str | None:
    parts = candidate.split(".")
    for index in range(len(parts), 0, -1):
        ref = ".".join(parts[:index])
        if ref in lookup:
            return lookup[ref]
    return None


def _resolve_from_import(
    current_module_name: str,
    module_name: str | None,
    level: int,
) -> str:
    if level == 0:
        return module_name or ""

    if "." in current_module_name:
        package_parts = current_module_name.rsplit(".", 1)[0].split(".")
    else:
        package_parts = [current_module_name]

    up_count = max(level - 1, 0)
    if up_count:
        package_parts = package_parts[: len(package_parts) - up_count]
    if module_name:
        package_parts.extend(module_name.split("."))
    return ".".join([part for part in package_parts if part])


def _call_path(node: ast.expr) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return f"{_call_path(node.value)}.{node.attr}"
    return "<expr>"


def analyze_python_file(
    file_path: Path,
    rel_path: str,
    module: ModuleFact,
    context: AnalyzerContext,
) -> AnalyzerResult:
    try:
        source = file_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return AnalyzerResult.empty()

    try:
        tree = ast.parse(source)
    except SyntaxError:
        return AnalyzerResult.empty()

    symbols: list[SymbolFact] = []
    interfaces: list[InterfaceFact] = []
    edges: list[EdgeFact] = []
    evidences: list[Evidence] = []

    edge_seen: set[tuple[str, str, str, str]] = set()

    module_name = module.name

    def add_evidence(node: ast.AST, parser: str) -> Evidence:
        line_start = int(getattr(node, "lineno", 1))
        line_end = int(getattr(node, "end_lineno", line_start))
        evidence_id = stable_id(rel_path, str(line_start), str(line_end), parser)
        evidence = Evidence(
            id=evidence_id,
            file_path=rel_path,
            line_start=line_start,
            line_end=line_end,
            parser=parser,
        )
        evidences.append(evidence)
        return evidence

    def add_symbol(node: ast.AST, name: str, kind: str) -> None:
        evidence = add_evidence(node, "python-ast")
        symbol_id = stable_id(module.id, name, kind, evidence.id)
        visibility = "public" if not name.startswith("_") else "private"
        symbols.append(
            SymbolFact(
                id=symbol_id,
                module_id=module.id,
                name=name,
                kind=kind,
                visibility=visibility,
                line=evidence.line_start,
            )
        )

    def add_dependency(node: ast.AST, target_module_id: str, label: str, kind: str = "dependency") -> None:
        if target_module_id == module.id:
            return
        key = (module.id, target_module_id, kind, label)
        if key in edge_seen:
            return
        edge_seen.add(key)
        evidence = add_evidence(node, "python-ast")
        edge_id = stable_id(module.id, target_module_id, label, evidence.id)
        edges.append(
            EdgeFact(
                id=edge_id,
                src_module_id=module.id,
                dst_module_id=target_module_id,
                kind=kind,
                label=label,
                evidence_id=evidence.id,
            )
        )

    def add_interface(node: ast.AST, name: str, protocol: str, direction: str, details: str) -> None:
        evidence = add_evidence(node, "python-ast")
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

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            add_symbol(node, node.name, "function")

            for decorator in node.decorator_list:
                if isinstance(decorator, ast.Call) and isinstance(decorator.func, ast.Attribute):
                    method = decorator.func.attr.lower()
                    if method in HTTP_METHODS:
                        route = "/"
                        if decorator.args:
                            first = decorator.args[0]
                            if isinstance(first, ast.Constant) and isinstance(first.value, str):
                                route = first.value
                        add_interface(
                            node,
                            name=f"{method.upper()} {route}",
                            protocol="HTTP",
                            direction="in",
                            details=f"python route via {decorator.func.attr}",
                        )

        if isinstance(node, ast.ClassDef):
            add_symbol(node, node.name, "class")

        if isinstance(node, ast.Import):
            for alias in node.names:
                target = _resolve_python_module(alias.name, context.python_name_to_module_id)
                if target:
                    add_dependency(node, target, label=f"import {alias.name}")

        if isinstance(node, ast.ImportFrom):
            base_name = _resolve_from_import(module_name, node.module, node.level)
            candidates = []
            if base_name:
                candidates.append(base_name)
            for alias in node.names:
                if base_name:
                    candidates.append(f"{base_name}.{alias.name}")
            resolved = None
            for candidate in candidates:
                resolved = _resolve_python_module(candidate, context.python_name_to_module_id)
                if resolved:
                    break
            if resolved:
                add_dependency(
                    node,
                    resolved,
                    label=f"from {node.module or '.'} import {', '.join(item.name for item in node.names)}",
                )

        if isinstance(node, ast.Call):
            call_name = _call_path(node.func)
            if call_name.endswith("requests.get") or call_name.endswith("requests.post"):
                add_interface(
                    node,
                    name=call_name,
                    protocol="HTTP",
                    direction="out",
                    details="outbound requests call",
                )

    return AnalyzerResult(symbols=symbols, interfaces=interfaces, edges=edges, evidences=evidences)
