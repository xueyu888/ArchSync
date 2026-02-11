from __future__ import annotations

import subprocess
import tarfile
import tempfile
from pathlib import Path


class GitError(RuntimeError):
    pass


def _run_git(repo: Path, args: list[str]) -> str:
    proc = subprocess.run(
        ["git", *args],
        cwd=repo,
        check=False,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise GitError(proc.stderr.strip() or proc.stdout.strip())
    return proc.stdout.strip()


def resolve_ref(repo: Path, ref: str) -> str:
    return _run_git(repo, ["rev-parse", "--verify", ref])


def current_commit(repo: Path) -> str:
    try:
        return _run_git(repo, ["rev-parse", "--short", "HEAD"])
    except GitError:
        return "working-tree"


def changed_files(repo: Path, base: str, head: str) -> list[str]:
    out = _run_git(repo, ["diff", "--name-only", f"{base}..{head}"])
    return [line for line in out.splitlines() if line.strip()]


def materialize_ref(repo: Path, ref: str) -> Path:
    temp_dir = Path(tempfile.mkdtemp(prefix=f"archsync-{ref.replace('/', '_')}-"))
    tar_path = temp_dir / "archive.tar"
    with tar_path.open("wb") as handle:
        proc = subprocess.run(
            ["git", "archive", "--format=tar", ref],
            cwd=repo,
            check=False,
            stdout=handle,
            stderr=subprocess.PIPE,
            text=False,
        )
    if proc.returncode != 0:
        raise GitError(proc.stderr.decode("utf-8", errors="ignore").strip())

    extract_path = temp_dir / "tree"
    extract_path.mkdir(parents=True, exist_ok=True)
    with tarfile.open(tar_path, "r") as tar:
        try:
            tar.extractall(path=extract_path, filter="data")
        except TypeError:
            tar.extractall(path=extract_path)
    return extract_path
