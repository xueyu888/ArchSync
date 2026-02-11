from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

DEFAULT_RULES = """system_name: ArchSync System
module_depth: 2
include:
  - "backend/*.py"
  - "backend/**/*.py"
  - "frontend/*.{js,jsx,ts,tsx}"
  - "frontend/**/*.{js,jsx,ts,tsx}"
exclude:
  - "**/.git/**"
  - "**/node_modules/**"
  - "**/.venv/**"
layers:
  - name: Frontend
    match:
      - "frontend/**"
  - name: Backend
    match:
      - "backend/**"
default_layer: Misc
interfaces:
  - pattern: '(?i)(/api/|router\\.|app\\.(get|post|put|delete|patch))'
    protocol: HTTP
    direction: in
  - pattern: '(?i)(fetch\\(|axios\\.)'
    protocol: HTTP
    direction: out
constraints:
  layer_order:
    - Frontend
    - Backend
    - Misc
  forbidden_dependencies:
    - from: Backend
      to: Frontend
      severity: high
llm:
  enabled: false
  provider: openai_compatible
  model: qwen2.5-coder:14b
  endpoint: "http://127.0.0.1:11434/v1"
  api_key: ""
  temperature: 0.0
"""


@dataclass(slots=True)
class LayerRule:
    name: str
    match: list[str]


@dataclass(slots=True)
class InterfaceRule:
    pattern: str
    protocol: str
    direction: str


@dataclass(slots=True)
class ForbiddenDependency:
    from_value: str
    to_value: str
    severity: str = "high"


@dataclass(slots=True)
class Constraints:
    layer_order: list[str] = field(default_factory=list)
    forbidden_dependencies: list[ForbiddenDependency] = field(default_factory=list)


@dataclass(slots=True)
class LLMConfig:
    enabled: bool = False
    provider: str = "openai_compatible"
    model: str = ""
    endpoint: str = ""
    api_key: str = ""
    temperature: float = 0.0


@dataclass(slots=True)
class RulesConfig:
    system_name: str
    module_depth: int
    include: list[str]
    exclude: list[str]
    layers: list[LayerRule]
    default_layer: str
    interfaces: list[InterfaceRule]
    constraints: Constraints
    llm: LLMConfig

    @classmethod
    def default(cls) -> RulesConfig:
        data = yaml.safe_load(DEFAULT_RULES)
        return cls.from_dict(data)

    @classmethod
    def from_path(cls, path: Path) -> RulesConfig:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        return cls.from_dict(data)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RulesConfig:
        layer_rules = [LayerRule(name=item["name"], match=item.get("match", [])) for item in data.get("layers", [])]
        interface_rules = [
            InterfaceRule(
                pattern=item["pattern"],
                protocol=item.get("protocol", "UNKNOWN"),
                direction=item.get("direction", "bidir"),
            )
            for item in data.get("interfaces", [])
        ]
        constraints_data = data.get("constraints", {})
        forbidden = [
            ForbiddenDependency(
                from_value=item.get("from", ""),
                to_value=item.get("to", ""),
                severity=item.get("severity", "high"),
            )
            for item in constraints_data.get("forbidden_dependencies", [])
        ]
        constraints = Constraints(
            layer_order=constraints_data.get("layer_order", []),
            forbidden_dependencies=forbidden,
        )
        llm_data = data.get("llm", {})
        llm = LLMConfig(
            enabled=bool(llm_data.get("enabled", False)),
            provider=llm_data.get("provider", "openai_compatible"),
            model=llm_data.get("model", ""),
            endpoint=llm_data.get("endpoint", ""),
            api_key=llm_data.get("api_key", ""),
            temperature=float(llm_data.get("temperature", 0.0)),
        )
        return cls(
            system_name=data.get("system_name", "ArchSync System"),
            module_depth=int(data.get("module_depth", 2)),
            include=data.get("include", ["**/*.py", "**/*.js", "**/*.jsx", "**/*.ts", "**/*.tsx"]),
            exclude=data.get("exclude", ["**/.git/**", "**/node_modules/**", "**/.venv/**"]),
            layers=layer_rules,
            default_layer=data.get("default_layer", "Misc"),
            interfaces=interface_rules,
            constraints=constraints,
            llm=llm,
        )


def ensure_rules(path: Path, force: bool = False) -> None:
    if path.exists() and not force:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(DEFAULT_RULES, encoding="utf-8")
