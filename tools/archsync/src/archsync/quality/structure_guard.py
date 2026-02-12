from __future__ import annotations

import argparse
from dataclasses import dataclass
from fnmatch import fnmatch
from pathlib import Path

import yaml

DEFAULT_LIMITS = {
    "py": 900,
    "js": 1200,
    "jsx": 1200,
    "ts": 1200,
    "tsx": 1200,
    "css": 1600,
}

DEFAULT_EXCLUDED_DIRS = {
    ".git",
    ".venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "node_modules",
    "dist",
    "build",
    "coverage",
}


@dataclass(slots=True)
class LimitConfig:
    limits: dict[str, int]
    overrides: dict[str, int]
    excluded_dirs: set[str]


@dataclass(slots=True)
class LimitViolation:
    path: str
    lines: int
    limit: int


def _to_positive_int(value: object, fallback: int) -> int:
    if isinstance(value, bool):
        return fallback
    if isinstance(value, int):
        return value if value > 0 else fallback
    if isinstance(value, str):
        try:
            num = int(value)
            return num if num > 0 else fallback
        except ValueError:
            return fallback
    return fallback


def load_limit_config(path: Path | None) -> LimitConfig:
    limits = dict(DEFAULT_LIMITS)
    overrides: dict[str, int] = {}
    excluded_dirs = set(DEFAULT_EXCLUDED_DIRS)
    if not path or not path.exists():
        return LimitConfig(limits=limits, overrides=overrides, excluded_dirs=excluded_dirs)

    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}

    limits_raw = raw.get("default_limits", {})
    if isinstance(limits_raw, dict):
        for ext, limit in limits_raw.items():
            key = str(ext).lstrip(".").lower().strip()
            if not key:
                continue
            limits[key] = _to_positive_int(limit, limits.get(key, 1200))

    overrides_raw = raw.get("overrides", {})
    if isinstance(overrides_raw, dict):
        for pattern, limit in overrides_raw.items():
            pattern_key = str(pattern).strip().replace("\\", "/")
            if not pattern_key:
                continue
            overrides[pattern_key] = _to_positive_int(limit, 1200)

    excluded_raw = raw.get("excluded_dirs", [])
    if isinstance(excluded_raw, list):
        for name in excluded_raw:
            label = str(name).strip()
            if label:
                excluded_dirs.add(label)

    return LimitConfig(limits=limits, overrides=overrides, excluded_dirs=excluded_dirs)


def _count_lines(path: Path) -> int:
    with path.open("r", encoding="utf-8", errors="ignore") as handle:
        return sum(1 for _ in handle)


def _resolve_limit(rel_path: str, config: LimitConfig) -> int | None:
    for pattern, limit in config.overrides.items():
        if fnmatch(rel_path, pattern):
            return limit
    ext = Path(rel_path).suffix.lower().lstrip(".")
    if not ext:
        return None
    return config.limits.get(ext)


def collect_violations(repo_root: Path, config: LimitConfig) -> list[LimitViolation]:
    violations: list[LimitViolation] = []
    for file_path in repo_root.rglob("*"):
        if not file_path.is_file():
            continue
        rel_path = file_path.relative_to(repo_root).as_posix()
        parts = set(file_path.relative_to(repo_root).parts)
        if parts & config.excluded_dirs:
            continue
        limit = _resolve_limit(rel_path, config)
        if limit is None:
            continue
        lines = _count_lines(file_path)
        if lines > limit:
            violations.append(LimitViolation(path=rel_path, lines=lines, limit=limit))
    violations.sort(key=lambda item: (item.path, item.lines))
    return violations


def format_violations(violations: list[LimitViolation]) -> str:
    header = "Structure guard failed: file line limits exceeded."
    rows = [f"- {item.path}: {item.lines} lines (limit {item.limit})" for item in violations]
    return "\n".join([header, *rows])


def run_structure_guard(repo_root: Path, config_path: Path | None) -> int:
    config = load_limit_config(config_path)
    violations = collect_violations(repo_root, config)
    if not violations:
        print("Structure guard passed.")
        return 0
    print(format_violations(violations))
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Check line-count limits for maintainability.")
    parser.add_argument("--repo", default=".", help="Repository root path.")
    parser.add_argument(
        "--config",
        default=".archsync/strict_limits.yaml",
        help="Path to strict limits config (yaml).",
    )
    args = parser.parse_args()

    repo_root = Path(args.repo).resolve()
    config_path = Path(args.config).resolve()
    return run_structure_guard(repo_root=repo_root, config_path=config_path)


if __name__ == "__main__":
    raise SystemExit(main())

