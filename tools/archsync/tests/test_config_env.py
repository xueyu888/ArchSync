from __future__ import annotations

from archsync.config import RulesConfig


def test_local_llm_env_overrides(monkeypatch) -> None:
    monkeypatch.setenv("LOCAL_LLM_URL", "http://127.0.0.1:9090/v1")
    monkeypatch.setenv("LOCAL_LLM_MODEL", "qwen3")
    monkeypatch.setenv("LOCAL_LLM_KEY", "secret")
    monkeypatch.setenv("LOCAL_LLM_ENABLED", "true")
    monkeypatch.setenv("LOCAL_LLM_TEMPERATURE", "0.2")

    rules = RulesConfig.default()

    assert rules.llm.enabled is True
    assert rules.llm.provider == "openai_compatible"
    assert rules.llm.endpoint == "http://127.0.0.1:9090/v1"
    assert rules.llm.model == "qwen3"
    assert rules.llm.api_key == "secret"
    assert rules.llm.temperature == 0.2
