from __future__ import annotations

from pathlib import Path

from archsync.analyzers.engine import extract_facts
from archsync.config import RulesConfig
from archsync.llm.provider import EnrichmentResult
from archsync.model.builder import build_architecture_model
from archsync.model.enrichment import enrich_architecture_model


def test_enrichment_moves_llm_side_effects_to_pipeline_boundary(monkeypatch, tmp_path: Path) -> None:
    repo = Path(__file__).parent / "fixtures" / "sample_repo"
    rules = RulesConfig.default()
    snapshot = extract_facts(repo_root=repo, rules=rules, commit_id="enrich")
    base_model = build_architecture_model(snapshot=snapshot, rules=rules)

    target = next(item for item in base_model.modules if item.level >= 1)
    fallback_only = next(item for item in base_model.modules if item.level >= 1 and item.id != target.id)

    class FakeProvider:
        def enrich(self, modules):  # noqa: ANN001
            assert modules
            return EnrichmentResult(
                names={target.id: "重命名模块"},
                summaries={
                    target.id: "这是中文摘要。",
                    fallback_only.id: "english summary only",
                },
            )

    monkeypatch.setattr("archsync.model.enrichment.build_provider", lambda *_: FakeProvider())

    enriched = enrich_architecture_model(
        model=base_model,
        rules=rules,
        llm_audit_dir=tmp_path / "llm_audit",
    )

    renamed = next(item for item in enriched.modules if item.id == target.id)
    assert renamed.name == "重命名模块"
    assert enriched.metadata["llm_summaries"][target.id] == "这是中文摘要。"
    assert enriched.metadata["llm_summary_source"][target.id] == "llm"

    assert enriched.metadata["llm_summary_source"][fallback_only.id] == "fallback"
    assert (
        enriched.metadata["llm_summaries"][fallback_only.id]
        == base_model.metadata["llm_summaries"][fallback_only.id]
    )
