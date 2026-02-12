from __future__ import annotations

import argparse
import subprocess
import threading
from pathlib import Path

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

WATCH_SUFFIXES = {".py", ".js", ".jsx", ".ts", ".tsx", ".css", ".json", ".yml", ".yaml"}
IGNORED_DIRS = {
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
    ".archsync",
}


def _in_repo(path: Path, repo_root: Path) -> bool:
    try:
        path.resolve().relative_to(repo_root.resolve())
        return True
    except ValueError:
        return False


def should_trigger(path: Path, repo_root: Path) -> bool:
    if not _in_repo(path, repo_root):
        return False
    rel = path.resolve().relative_to(repo_root.resolve())
    if any(part in IGNORED_DIRS for part in rel.parts):
        return False
    if rel.name.startswith("."):
        return False
    return rel.suffix.lower() in WATCH_SUFFIXES


class DebouncedGateRunner:
    def __init__(self, repo_root: Path, delay_seconds: float = 1.2) -> None:
        self.repo_root = repo_root
        self.delay_seconds = delay_seconds
        self._lock = threading.Lock()
        self._timer: threading.Timer | None = None
        self._running = False
        self._pending = False

    def request(self) -> None:
        with self._lock:
            if self._timer:
                self._timer.cancel()
            self._timer = threading.Timer(self.delay_seconds, self._flush)
            self._timer.daemon = True
            self._timer.start()

    def _flush(self) -> None:
        with self._lock:
            if self._running:
                self._pending = True
                return
            self._running = True
        try:
            self._run_gate()
            while True:
                with self._lock:
                    if not self._pending:
                        self._running = False
                        break
                    self._pending = False
                self._run_gate()
        finally:
            with self._lock:
                self._running = False

    def _run_gate(self) -> None:
        print("[AGENTS_STRICT_WATCH] change detected -> run quick gate")
        result = subprocess.run(
            ["bash", str(self.repo_root / "scripts" / "archsync_strict.sh"), "--quick"],
            cwd=self.repo_root,
            check=False,
        )
        if result.returncode == 0:
            print("[AGENTS_STRICT_WATCH] quick gate passed")
        else:
            print(f"[AGENTS_STRICT_WATCH] quick gate failed (exit={result.returncode})")


class StrictWatchHandler(FileSystemEventHandler):
    def __init__(self, repo_root: Path, gate_runner: DebouncedGateRunner) -> None:
        self.repo_root = repo_root
        self.gate_runner = gate_runner

    def on_any_event(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        paths = [Path(event.src_path)]
        dest_path = getattr(event, "dest_path", "")
        if dest_path:
            paths.append(Path(dest_path))
        if any(should_trigger(path, self.repo_root) for path in paths):
            self.gate_runner.request()


def run_watch(repo_root: Path, delay_seconds: float) -> int:
    if not (repo_root / "scripts" / "archsync_strict.sh").exists():
        print("missing scripts/archsync_strict.sh")
        return 2

    runner = DebouncedGateRunner(repo_root=repo_root, delay_seconds=delay_seconds)
    handler = StrictWatchHandler(repo_root=repo_root, gate_runner=runner)

    observer = Observer()
    observer.schedule(handler, str(repo_root), recursive=True)
    observer.start()
    print(f"[AGENTS_STRICT_WATCH] watching {repo_root}")
    print("[AGENTS_STRICT_WATCH] press Ctrl+C to stop")
    try:
        while True:
            observer.join(timeout=1.0)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Watch source changes and run AGENTS_STRICT quick gate.")
    parser.add_argument("--repo", default=".", help="Repository root.")
    parser.add_argument("--delay", type=float, default=1.2, help="Debounce delay in seconds.")
    args = parser.parse_args()
    return run_watch(repo_root=Path(args.repo).resolve(), delay_seconds=max(0.2, args.delay))


if __name__ == "__main__":
    raise SystemExit(main())

