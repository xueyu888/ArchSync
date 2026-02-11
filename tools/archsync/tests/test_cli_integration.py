import shutil
import subprocess
from pathlib import Path

from typer.testing import CliRunner

from archsync.cli import app

runner = CliRunner()


def _run(cmd: list[str], cwd: Path) -> None:
    subprocess.run(cmd, cwd=cwd, check=True)


def _init_git(repo: Path) -> None:
    _run(["git", "init", "-b", "main"], repo)
    _run(["git", "config", "user.name", "tester"], repo)
    _run(["git", "config", "user.email", "tester@example.com"], repo)


def _commit_all(repo: Path, msg: str) -> None:
    _run(["git", "add", "."], repo)
    _run(["git", "commit", "-m", msg], repo)


def test_cli_build_and_diff(tmp_path) -> None:
    fixture = Path(__file__).parent / "fixtures" / "sample_repo"
    repo = tmp_path / "repo"
    shutil.copytree(fixture, repo)

    _init_git(repo)

    result = runner.invoke(app, ["init", "--repo", str(repo)])
    assert result.exit_code == 0

    _commit_all(repo, "baseline")

    api_file = repo / "frontend" / "src" / "api.js"
    api_file.write_text(
        """export async function fetchUsers() {\n  const response = await fetch('/api/users')\n  return response.json()\n}\n\nexport async function fetchHealth() {\n  return fetch('/api/health')\n}\n""",
        encoding="utf-8",
    )
    _commit_all(repo, "feat: add health endpoint call")

    build = runner.invoke(app, ["build", "--repo", str(repo), "--full"])
    assert build.exit_code == 0
    assert (repo / "docs" / "archsync" / "architecture.model.json").exists()
    assert (repo / "docs" / "archsync" / "workspace.dsl").exists()
    assert (repo / "docs" / "archsync" / "architecture.dot").exists()
    assert (repo / "docs" / "archsync" / "mermaid" / "l1.mmd").exists()

    diff = runner.invoke(
        app,
        [
            "diff",
            "--repo",
            str(repo),
            "--base",
            "HEAD~1",
            "--head",
            "HEAD",
        ],
    )
    assert diff.exit_code == 0
    assert (repo / "docs" / "archsync" / "diff" / "report.md").exists()
