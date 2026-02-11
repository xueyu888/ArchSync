from __future__ import annotations

import json
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Protocol

import httpx

from archsync.config import LLMConfig
from archsync.utils import stable_id, utc_now_iso, write_json


@dataclass(slots=True)
class ModuleDraft:
    id: str
    name: str
    layer: str
    path: str


@dataclass(slots=True)
class EnrichmentResult:
    names: dict[str, str]
    summaries: dict[str, str]


class LLMProvider(Protocol):
    def enrich(self, modules: list[ModuleDraft]) -> EnrichmentResult:
        ...


class NoopProvider:
    def enrich(self, modules: list[ModuleDraft]) -> EnrichmentResult:
        return EnrichmentResult(names={}, summaries={})


class OpenAICompatibleProvider:
    def __init__(self, config: LLMConfig, audit_dir: Path) -> None:
        self.config = config
        self.audit_dir = audit_dir
        self.audit_dir.mkdir(parents=True, exist_ok=True)

    def enrich(self, modules: list[ModuleDraft]) -> EnrichmentResult:
        if not modules or not self.config.endpoint or not self.config.model:
            return EnrichmentResult(names={}, summaries={})

        payload_modules = [
            {
                "id": item.id,
                "name": item.name,
                "layer": item.layer,
                "path": item.path,
            }
            for item in modules
        ]
        prompt = {
            "task": "summarize_modules_in_chinese",
            "rules": [
                "不要虚构不存在的文件、依赖或接口。",
                "每个模块输出一句简短中文说明，15-35个字。",
                "说明需聚焦模块职责与层次定位。",
                "严格输出 JSON，不要输出额外文本。",
            ],
            "modules": payload_modules,
            "schema": {
                "module_summaries": [{"id": "str", "summary_zh": "str", "name": "str(optional)"}],
            },
        }
        prompt_blob = json.dumps(prompt, ensure_ascii=False, sort_keys=True)
        prompt_hash = sha256(prompt_blob.encode()).hexdigest()

        headers = {"Content-Type": "application/json"}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"

        request_payload = {
            "model": self.config.model,
            "temperature": self.config.temperature,
            "messages": [
                {"role": "system", "content": "你是软件架构分析助手，负责输出简洁准确的中文模块说明。"},
                {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
            ],
            "response_format": {"type": "json_object"},
        }

        response_json: dict | None = None
        error_message = ""
        try:
            with httpx.Client(timeout=30.0) as client:
                response = client.post(f"{self.config.endpoint.rstrip('/')}/chat/completions", headers=headers, json=request_payload)
                response.raise_for_status()
                body = response.json()
                content = body["choices"][0]["message"]["content"]
                response_json = json.loads(content)
        except Exception as exc:  # noqa: BLE001
            error_message = str(exc)

        audit_record = {
            "id": stable_id(self.config.model, utc_now_iso(), str(len(modules))),
            "timestamp": utc_now_iso(),
            "provider": "openai_compatible",
            "prompt_hash": prompt_hash,
            "input_evidence_ids": [item.id for item in modules],
            "model": self.config.model,
            "endpoint": self.config.endpoint,
            "temperature": self.config.temperature,
            "input_modules": payload_modules,
            "request_payload": request_payload,
            "response": response_json,
            "error": error_message,
        }
        write_json(self.audit_dir / f"{audit_record['id']}.json", audit_record)

        if not response_json:
            return EnrichmentResult(names={}, summaries={})

        names: dict[str, str] = {}
        summaries: dict[str, str] = {}

        for item in response_json.get("module_summaries", []):
            module_id = item.get("id")
            if not module_id:
                continue
            name = item.get("name", "")
            summary = item.get("summary_zh", "") or item.get("summary", "")
            if isinstance(name, str) and name.strip():
                names[module_id] = name.strip()
            if isinstance(summary, str) and summary.strip():
                summaries[module_id] = summary.strip()

        for item in response_json.get("renamed_modules", []):
            module_id = item.get("id")
            if not module_id:
                continue
            name = item.get("name", "")
            summary = item.get("summary", "") or item.get("summary_zh", "")
            if isinstance(name, str) and name.strip():
                names[module_id] = name.strip()
            if isinstance(summary, str) and summary.strip():
                summaries[module_id] = summary.strip()

        return EnrichmentResult(names=names, summaries=summaries)


def build_provider(config: LLMConfig, audit_dir: Path) -> LLMProvider:
    if not config.enabled:
        return NoopProvider()
    if config.provider == "openai_compatible":
        return OpenAICompatibleProvider(config, audit_dir)
    return NoopProvider()
