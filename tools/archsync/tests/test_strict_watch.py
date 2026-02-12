from __future__ import annotations

from pathlib import Path

from archsync.quality.strict_watch import should_trigger


def test_should_trigger_for_supported_source_file(tmp_path: Path) -> None:
    target = tmp_path / "frontend" / "src" / "App.jsx"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("export default function App() {}", encoding="utf-8")

    assert should_trigger(target, tmp_path)


def test_should_not_trigger_in_ignored_dir(tmp_path: Path) -> None:
    target = tmp_path / "node_modules" / "pkg" / "index.js"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("module.exports = {}", encoding="utf-8")

    assert not should_trigger(target, tmp_path)

