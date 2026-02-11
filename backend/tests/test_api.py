from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main


client = TestClient(main.app)


def _prepare_output(repo: Path, output: str = "docs/archsync") -> None:
    out_dir = repo / output
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "architecture.model.json").write_text(
        json.dumps({"modules": [{"id": "m1"}], "ports": [], "edges": []}),
        encoding="utf-8",
    )
    (out_dir / "facts.snapshot.json").write_text(
        json.dumps({"evidences": []}),
        encoding="utf-8",
    )


def test_health() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"


def test_build_and_model(monkeypatch, tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir(parents=True)

    def fake_resolve_repo(_: str) -> Path:
        return repo

    def fake_run_archsync(args: list[str], cwd: Path, check: bool = True):  # noqa: ARG001
        _prepare_output(repo)
        return SimpleNamespace(returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr(main, "_resolve_repo", fake_resolve_repo)
    monkeypatch.setattr(main, "_run_archsync", fake_run_archsync)

    build = client.post("/api/archsync/build", json={"repo_path": "."})
    assert build.status_code == 200
    body = build.json()
    assert body["ok"] is True
    assert body["summary"]["modules"] == 1

    model = client.get("/api/archsync/model", params={"repo_path": ".", "auto_build": False})
    assert model.status_code == 200
    model_json = model.json()
    assert model_json["ok"] is True
    assert len(model_json["model"]["modules"]) == 1


def test_ci_pass_fail(monkeypatch, tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir(parents=True)

    report_dir = repo / "docs/archsync/ci"
    report_dir.mkdir(parents=True)
    (report_dir / "report.json").write_text(json.dumps({"violations": []}), encoding="utf-8")

    def fake_resolve_repo(_: str) -> Path:
        return repo

    def fake_run_archsync(args: list[str], cwd: Path, check: bool = True):  # noqa: ARG001
        fail_on = args[args.index("--fail-on") + 1]
        code = 0 if fail_on in {"high", "critical"} else 1
        return SimpleNamespace(returncode=code, stdout="ci", stderr="")

    monkeypatch.setattr(main, "_resolve_repo", fake_resolve_repo)
    monkeypatch.setattr(main, "_run_archsync", fake_run_archsync)

    passed = client.post("/api/archsync/ci", json={"repo_path": ".", "fail_on": "high"})
    assert passed.status_code == 200
    assert passed.json()["ok"] is True

    failed = client.post("/api/archsync/ci", json={"repo_path": ".", "fail_on": "low"})
    assert failed.status_code == 200
    assert failed.json()["ok"] is False
