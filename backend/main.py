from __future__ import annotations

import json
import subprocess
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

REPO_ROOT = Path(__file__).resolve().parents[1]
ARCHSYNC_DIR = REPO_ROOT / "tools" / "archsync"


class BuildRequest(BaseModel):
    repo_path: str = "."
    rules_path: str = ".archsync/rules.yaml"
    output_path: str = "docs/archsync"
    state_db_path: str = ".archsync/state.db"
    commit_id: str | None = None
    full: bool = True


class DiffRequest(BaseModel):
    repo_path: str = "."
    base: str = "main"
    head: str = "HEAD"
    rules_path: str = ".archsync/rules.yaml"
    output_path: str = "docs/archsync/diff"


class CIGateRequest(BaseModel):
    repo_path: str = "."
    base: str = "main"
    head: str = "HEAD"
    rules_path: str = ".archsync/rules.yaml"
    output_path: str = "docs/archsync/ci"
    fail_on: str = Field(default="high", pattern="^(none|low|medium|high|critical)$")


app = FastAPI(title="ArchSync Backend API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _resolve_repo(path_value: str) -> Path:
    raw = Path(path_value)
    resolved = raw.resolve() if raw.is_absolute() else (REPO_ROOT / raw).resolve()

    try:
        resolved.relative_to(REPO_ROOT)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"repo_path must stay inside workspace root: {REPO_ROOT}",
        ) from exc

    if not resolved.exists() or not resolved.is_dir():
        raise HTTPException(status_code=400, detail=f"repo_path is not a directory: {resolved}")

    return resolved


def _run_archsync(args: list[str], cwd: Path, check: bool = True) -> subprocess.CompletedProcess[str]:
    command = ["uv", "run", "--directory", str(ARCHSYNC_DIR), "archsync", *args]
    process = subprocess.run(command, cwd=cwd, check=False, capture_output=True, text=True)
    if check and process.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "archsync command failed",
                "command": command,
                "stdout": process.stdout,
                "stderr": process.stderr,
                "exit_code": process.returncode,
            },
        )
    return process


def _load_json(path: Path) -> dict:
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"missing file: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "archsync-backend",
        "repo_root": str(REPO_ROOT),
    }


@app.post("/api/archsync/init")
def init_archsync(repo_path: str = ".", force: bool = False) -> dict:
    repo = _resolve_repo(repo_path)
    args = ["init", "--repo", str(repo)]
    if force:
        args.append("--force")
    process = _run_archsync(args, cwd=repo, check=True)
    return {
        "ok": True,
        "stdout": process.stdout,
        "stderr": process.stderr,
    }


@app.post("/api/archsync/build")
def build_archsync(payload: BuildRequest) -> dict:
    repo = _resolve_repo(payload.repo_path)
    output = repo / payload.output_path

    args = [
        "build",
        "--repo",
        str(repo),
        "--rules",
        payload.rules_path,
        "--output",
        payload.output_path,
        "--state-db",
        payload.state_db_path,
    ]
    if payload.full:
        args.append("--full")
    if payload.commit_id:
        args.extend(["--commit-id", payload.commit_id])

    process = _run_archsync(args, cwd=repo, check=True)

    model_path = output / "architecture.model.json"
    snapshot_path = output / "facts.snapshot.json"
    model = _load_json(model_path)
    snapshot = _load_json(snapshot_path)

    return {
        "ok": True,
        "stdout": process.stdout,
        "stderr": process.stderr,
        "output": {
            "root": str(output),
            "model": str(model_path),
            "snapshot": str(snapshot_path),
        },
        "summary": {
            "modules": len(model.get("modules", [])),
            "ports": len(model.get("ports", [])),
            "edges": len(model.get("edges", [])),
            "evidences": len(snapshot.get("evidences", [])),
            "coverage": snapshot.get("metadata", {}).get("coverage", {}),
            "language_breakdown": snapshot.get("metadata", {}).get("language_breakdown", {}),
        },
        "model": model,
    }


@app.get("/api/archsync/model")
def get_model(
    repo_path: str = ".",
    output_path: str = "docs/archsync",
    auto_build: bool = True,
) -> dict:
    repo = _resolve_repo(repo_path)
    output = repo / output_path
    model_path = output / "architecture.model.json"

    if auto_build:
        _run_archsync([
            "build",
            "--repo",
            str(repo),
            "--output",
            output_path,
            "--rules",
            ".archsync/rules.yaml",
            "--state-db",
            ".archsync/state.db",
            "--full",
        ], cwd=repo, check=True)

    model = _load_json(model_path)
    snapshot_path = output / "facts.snapshot.json"
    snapshot = _load_json(snapshot_path) if snapshot_path.exists() else {}

    return {
        "ok": True,
        "output": {
            "model": str(model_path),
        },
        "model": model,
        "snapshot": snapshot,
    }


@app.post("/api/archsync/diff")
def diff_archsync(payload: DiffRequest) -> dict:
    repo = _resolve_repo(payload.repo_path)

    args = [
        "diff",
        "--repo",
        str(repo),
        "--base",
        payload.base,
        "--head",
        payload.head,
        "--rules",
        payload.rules_path,
        "--output",
        payload.output_path,
    ]
    process = _run_archsync(args, cwd=repo, check=True)

    report_json = _load_json(repo / payload.output_path / "report.json")
    report_md = (repo / payload.output_path / "report.md").read_text(encoding="utf-8")
    return {
        "ok": True,
        "stdout": process.stdout,
        "stderr": process.stderr,
        "report": report_json,
        "report_markdown": report_md,
    }


@app.post("/api/archsync/ci")
def ci_archsync(payload: CIGateRequest) -> dict:
    repo = _resolve_repo(payload.repo_path)

    args = [
        "ci",
        "--repo",
        str(repo),
        "--base",
        payload.base,
        "--head",
        payload.head,
        "--rules",
        payload.rules_path,
        "--output",
        payload.output_path,
        "--fail-on",
        payload.fail_on,
    ]

    process = _run_archsync(args, cwd=repo, check=False)
    report_path = repo / payload.output_path / "report.json"
    report = _load_json(report_path) if report_path.exists() else {}

    return {
        "ok": process.returncode == 0,
        "exit_code": process.returncode,
        "stdout": process.stdout,
        "stderr": process.stderr,
        "report": report,
    }


def main() -> None:
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=9000, reload=True)


if __name__ == "__main__":
    main()
