from __future__ import annotations

import json
import re
from collections.abc import Iterable
from datetime import UTC, datetime
from fnmatch import fnmatch
from hashlib import sha1
from pathlib import Path


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def stable_id(*parts: str) -> str:
    joined = "|".join(parts)
    return sha1(joined.encode("utf-8")).hexdigest()[:16]


def _expand_braces(pattern: str) -> list[str]:
    match = re.search(r"\{([^{}]+)\}", pattern)
    if not match:
        return [pattern]
    options = [item.strip() for item in match.group(1).split(",") if item.strip()]
    if not options:
        return [pattern]
    prefix = pattern[: match.start()]
    suffix = pattern[match.end() :]
    expanded: list[str] = []
    for option in options:
        expanded.extend(_expand_braces(f"{prefix}{option}{suffix}"))
    return expanded


def path_matches(path: str, patterns: Iterable[str]) -> bool:
    expanded_patterns: list[str] = []
    for pattern in patterns:
        expanded_patterns.extend(_expand_braces(pattern))
    return any(fnmatch(path, pattern) for pattern in expanded_patterns)


def is_included(path: str, include_patterns: list[str], exclude_patterns: list[str]) -> bool:
    include_ok = path_matches(path, include_patterns)
    exclude_hit = path_matches(path, exclude_patterns)
    return include_ok and not exclude_hit


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def sanitize_label(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())
