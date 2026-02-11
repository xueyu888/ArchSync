from __future__ import annotations

import re
from pathlib import Path, PurePosixPath

from archsync.analyzers.common import AnalyzerContext
from archsync.analyzers.js_analyzer import analyze_js_file
from archsync.analyzers.python_analyzer import analyze_python_file
from archsync.config import RulesConfig
from archsync.schemas import (
    EdgeFact,
    Evidence,
    FactsSnapshot,
    InterfaceFact,
    ModuleFact,
    SymbolFact,
)
from archsync.utils import is_included, stable_id

SUPPORTED_SUFFIXES = {".py", ".js", ".jsx", ".ts", ".tsx"}


def _language_for_path(rel_path: str) -> str:
    suffix = Path(rel_path).suffix.lower()
    if suffix == ".py":
        return "python"
    if suffix in {".js", ".jsx", ".ts", ".tsx"}:
        return "javascript"
    return "unknown"


def _python_module_name(rel_path: str) -> str:
    path = PurePosixPath(rel_path)
    if path.name == "__init__.py":
        return ".".join(path.with_suffix("").parts[:-1])
    return ".".join(path.with_suffix("").parts)


def discover_source_files(repo_root: Path, rules: RulesConfig) -> list[str]:
    files: list[str] = []
    for path in repo_root.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(repo_root).as_posix()
        if path.suffix.lower() not in SUPPORTED_SUFFIXES:
            continue
        if is_included(rel, rules.include, rules.exclude):
            files.append(rel)
    return sorted(files)


def _create_modules(rel_files: list[str]) -> list[ModuleFact]:
    modules: list[ModuleFact] = []
    for rel in rel_files:
        language = _language_for_path(rel)
        if language == "python":
            name = _python_module_name(rel)
        else:
            name = rel
        module_id = stable_id("module", rel)
        modules.append(
            ModuleFact(
                id=module_id,
                name=name,
                path=rel,
                language=language,
            )
        )
    return modules


def _infer_interfaces_from_rules(
    source: str,
    rel_path: str,
    module: ModuleFact,
    rules: RulesConfig,
    offset_evidence: int,
) -> tuple[list[InterfaceFact], list[Evidence]]:
    interfaces: list[InterfaceFact] = []
    evidences: list[Evidence] = []

    lines = source.splitlines()
    for line_no, line in enumerate(lines, start=1):
        for item in rules.interfaces:
            if not re.search(item.pattern, line):
                continue
            evidence_id = stable_id(rel_path, str(line_no), "rule-regex", str(offset_evidence))
            evidence = Evidence(
                id=evidence_id,
                file_path=rel_path,
                line_start=line_no,
                line_end=line_no,
                parser="rule-regex",
            )
            evidences.append(evidence)
            interface_id = stable_id(module.id, item.protocol, item.direction, evidence_id)
            interfaces.append(
                InterfaceFact(
                    id=interface_id,
                    module_id=module.id,
                    name=f"{item.protocol} inferred {line_no}",
                    protocol=item.protocol,
                    direction=item.direction,
                    details=f"Matched rule: {item.pattern}",
                    evidence_id=evidence_id,
                )
            )
            offset_evidence += 1
    return interfaces, evidences


def extract_facts(repo_root: Path, rules: RulesConfig, commit_id: str) -> FactsSnapshot:
    rel_files = discover_source_files(repo_root, rules)
    modules = _create_modules(rel_files)

    module_by_relpath = {item.path: item for item in modules}
    python_name_to_module_id = {item.name: item.id for item in modules if item.language == "python"}
    js_relpath_to_module_id = {item.path: item.id for item in modules if item.language == "javascript"}

    context = AnalyzerContext(
        repo_root=repo_root,
        module_by_relpath=module_by_relpath,
        python_name_to_module_id=python_name_to_module_id,
        js_relpath_to_module_id=js_relpath_to_module_id,
    )

    snapshot = FactsSnapshot.create(commit_id=commit_id, repo_root=str(repo_root))
    snapshot.modules.extend(modules)

    for module in modules:
        file_path = repo_root / module.path
        if module.language == "python":
            result = analyze_python_file(file_path, module.path, module, context)
        elif module.language == "javascript":
            result = analyze_js_file(file_path, module.path, module, context)
        else:
            continue

        snapshot.symbols.extend(result.symbols)
        snapshot.interfaces.extend(result.interfaces)
        snapshot.edges.extend(result.edges)
        snapshot.evidences.extend(result.evidences)

        try:
            source = file_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            source = ""

        inferred_interfaces, inferred_evidences = _infer_interfaces_from_rules(
            source=source,
            rel_path=module.path,
            module=module,
            rules=rules,
            offset_evidence=len(snapshot.evidences),
        )
        snapshot.interfaces.extend(inferred_interfaces)
        snapshot.evidences.extend(inferred_evidences)

    snapshot.evidences = _dedupe_evidences(snapshot.evidences)
    snapshot.interfaces = _dedupe_interfaces(snapshot.interfaces)
    snapshot.edges = _dedupe_edges(snapshot.edges)
    snapshot.symbols = _dedupe_symbols(snapshot.symbols)

    return snapshot


def _dedupe_evidences(items: list[Evidence]) -> list[Evidence]:
    result: list[Evidence] = []
    seen: set[str] = set()
    for item in items:
        if item.id in seen:
            continue
        seen.add(item.id)
        result.append(item)
    return result


def _dedupe_symbols(items: list[SymbolFact]) -> list[SymbolFact]:
    result: list[SymbolFact] = []
    seen: set[str] = set()
    for item in items:
        key = item.id
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _dedupe_interfaces(items: list[InterfaceFact]) -> list[InterfaceFact]:
    result: list[InterfaceFact] = []
    seen: set[tuple[str, str, str, str]] = set()
    for item in items:
        key = (item.module_id, item.name, item.protocol, item.direction)
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _dedupe_edges(items: list[EdgeFact]) -> list[EdgeFact]:
    result: list[EdgeFact] = []
    seen: set[tuple[str, str, str, str]] = set()
    for item in items:
        key = (item.src_module_id, item.dst_module_id, item.kind, item.label)
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result
