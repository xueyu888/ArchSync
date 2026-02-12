from __future__ import annotations

import re
from dataclasses import replace
from pathlib import Path

from archsync.config import RulesConfig
from archsync.llm.provider import ModuleDraft, build_provider
from archsync.schemas import ArchitectureModel, ModuleNode

CHINESE_RE = re.compile(r"[\u4e00-\u9fff]")


def _contains_chinese(text: str) -> bool:
    return bool(CHINESE_RE.search(text))


def enrich_architecture_model(
    model: ArchitectureModel,
    rules: RulesConfig,
    llm_audit_dir: Path,
) -> ArchitectureModel:
    provider = build_provider(rules.llm, llm_audit_dir)
    enrichables = [
        ModuleDraft(id=node.id, name=node.name, layer=node.layer, path=node.path)
        for node in model.modules
        if node.level >= 1
    ]
    enrichment = provider.enrich(enrichables)

    merged_summaries = dict(model.metadata.get("llm_summaries", {}))
    summary_source = dict(model.metadata.get("llm_summary_source", {}))
    for node in model.modules:
        summary_source.setdefault(node.id, "fallback")

    for module_id, summary in enrichment.summaries.items():
        clean = summary.strip()
        if not clean or not _contains_chinese(clean):
            continue
        merged_summaries[module_id] = clean
        summary_source[module_id] = "llm"

    renamed_modules: list[ModuleNode] = []
    for node in model.modules:
        candidate = enrichment.names.get(node.id, "")
        clean_name = candidate.strip() if isinstance(candidate, str) else ""
        if clean_name:
            renamed_modules.append(
                ModuleNode(
                    id=node.id,
                    name=clean_name,
                    layer=node.layer,
                    level=node.level,
                    path=node.path,
                    parent_id=node.parent_id,
                    evidence_ids=node.evidence_ids,
                )
            )
        else:
            renamed_modules.append(node)

    metadata = dict(model.metadata)
    metadata["llm_summaries"] = merged_summaries
    metadata["llm_summary_source"] = summary_source

    return replace(model, modules=renamed_modules, metadata=metadata)
