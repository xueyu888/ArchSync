from __future__ import annotations

from pathlib import Path

from archsync.quality.structure_guard import (
    LimitConfig,
    collect_violations,
    load_limit_config,
)


def write_lines(path: Path, count: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = "\n".join(f"line {idx}" for idx in range(count))
    path.write_text(text, encoding="utf-8")


def test_collect_violations_respects_defaults(tmp_path: Path) -> None:
    write_lines(tmp_path / "src" / "ok.py", 20)
    write_lines(tmp_path / "src" / "too_big.py", 120)
    config = LimitConfig(limits={"py": 100}, overrides={}, excluded_dirs=set())

    violations = collect_violations(tmp_path, config)

    assert len(violations) == 1
    assert violations[0].path == "src/too_big.py"
    assert violations[0].limit == 100


def test_collect_violations_uses_override_pattern(tmp_path: Path) -> None:
    write_lines(tmp_path / "frontend" / "src" / "App.jsx", 150)
    config = LimitConfig(
        limits={"jsx": 100},
        overrides={"frontend/src/App.jsx": 200},
        excluded_dirs=set(),
    )

    violations = collect_violations(tmp_path, config)

    assert not violations


def test_load_limit_config_parses_yaml(tmp_path: Path) -> None:
    config_path = tmp_path / "strict_limits.yaml"
    config_path.write_text(
        "\n".join(
            [
                "default_limits:",
                "  py: 88",
                "overrides:",
                "  frontend/src/App.jsx: 3010",
                "excluded_dirs:",
                "  - custom_cache",
            ]
        ),
        encoding="utf-8",
    )

    config = load_limit_config(config_path)

    assert config.limits["py"] == 88
    assert config.overrides["frontend/src/App.jsx"] == 3010
    assert "custom_cache" in config.excluded_dirs

