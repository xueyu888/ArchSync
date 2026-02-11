from __future__ import annotations

import copy
import tempfile
from pathlib import Path

import typer

from archsync.config import RulesConfig, ensure_rules
from archsync.diff.engine import build_diff_report
from archsync.diff.report_writer import write_diff_json, write_diff_markdown
from archsync.git_utils import changed_files, materialize_ref, resolve_ref
from archsync.pipeline import run_build
from archsync.watch.service import watch_loop

app = typer.Typer(help="ArchSync: interface-first architecture diagrams and diff gates")


def _load_rules(path: Path) -> RulesConfig:
    if not path.exists():
        ensure_rules(path)
    return RulesConfig.from_path(path)


def _severity_rank(value: str) -> int:
    order = {"none": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
    return order.get(value.lower(), 3)


@app.command()
def init(
    repo: Path = typer.Option(Path("."), help="Repository root"),
    rules: Path = typer.Option(Path(".archsync/rules.yaml"), help="Rules config path"),
    force: bool = typer.Option(False, help="Overwrite existing config"),
) -> None:
    repo = repo.resolve()
    rules = (repo / rules).resolve() if not rules.is_absolute() else rules
    ensure_rules(rules, force=force)

    state_dir = repo / ".archsync"
    docs_dir = repo / "docs" / "archsync"
    state_dir.mkdir(parents=True, exist_ok=True)
    docs_dir.mkdir(parents=True, exist_ok=True)

    typer.echo(f"[archsync] initialized rules at {rules}")
    typer.echo(f"[archsync] output directory: {docs_dir}")


@app.command()
def build(
    repo: Path = typer.Option(Path("."), help="Repository root"),
    rules: Path = typer.Option(Path(".archsync/rules.yaml"), help="Rules config path"),
    output: Path = typer.Option(Path("docs/archsync"), help="Output directory"),
    state_db: Path = typer.Option(Path(".archsync/state.db"), help="SQLite state database"),
    commit_id: str = typer.Option("", help="Override commit id"),
) -> None:
    repo = repo.resolve()
    rules_path = (repo / rules).resolve() if not rules.is_absolute() else rules
    output_dir = (repo / output).resolve() if not output.is_absolute() else output
    state_path = (repo / state_db).resolve() if not state_db.is_absolute() else state_db

    rules_config = _load_rules(rules_path)
    result = run_build(
        repo_root=repo,
        rules=rules_config,
        output_dir=output_dir,
        state_db=state_path,
        commit_id=commit_id or None,
    )

    typer.echo("[archsync] build complete")
    typer.echo(f"- modules: {len(result.model.modules)}")
    typer.echo(f"- ports: {len(result.model.ports)}")
    typer.echo(f"- edges: {len(result.model.edges)}")
    typer.echo(f"- dashboard: {result.outputs['dashboard']}")


@app.command()
def diff(
    repo: Path = typer.Option(Path("."), help="Repository root"),
    base: str = typer.Option("main", help="Base git ref"),
    head: str = typer.Option("HEAD", help="Head git ref"),
    rules: Path = typer.Option(Path(".archsync/rules.yaml"), help="Rules config path"),
    output: Path = typer.Option(Path("docs/archsync/diff"), help="Diff output directory"),
) -> None:
    repo = repo.resolve()
    rules_path = (repo / rules).resolve() if not rules.is_absolute() else rules
    output_dir = (repo / output).resolve() if not output.is_absolute() else output
    output_dir.mkdir(parents=True, exist_ok=True)

    rules_config = _load_rules(rules_path)
    rules_for_diff = copy.deepcopy(rules_config)
    rules_for_diff.llm.enabled = False

    base_ref = resolve_ref(repo, base)
    head_ref = resolve_ref(repo, head)

    base_tree = materialize_ref(repo, base_ref)
    head_tree = materialize_ref(repo, head_ref)

    temp_state = Path(tempfile.mkdtemp(prefix="archsync-diff-state-")) / "state.db"
    base_build = run_build(
        repo_root=base_tree,
        rules=rules_for_diff,
        output_dir=output_dir / "base",
        state_db=temp_state,
        commit_id=base_ref[:8],
    )
    head_build = run_build(
        repo_root=head_tree,
        rules=rules_for_diff,
        output_dir=output_dir / "head",
        state_db=temp_state,
        commit_id=head_ref[:8],
    )

    files = changed_files(repo, base_ref, head_ref)
    report = build_diff_report(
        base_model=base_build.model,
        head_model=head_build.model,
        rules=rules_for_diff,
        changed_files=files,
    )

    report_md = output_dir / "report.md"
    report_json = output_dir / "report.json"
    write_diff_markdown(report, report_md)
    write_diff_json(report, report_json)

    typer.echo("[archsync] diff complete")
    typer.echo(f"- base: {base_ref}")
    typer.echo(f"- head: {head_ref}")
    typer.echo(f"- report: {report_md}")
    typer.echo(f"- violations: {len(report.violations)}")
    typer.echo(f"- cycles: {len(report.cycles)}")


@app.command()
def ci(
    repo: Path = typer.Option(Path("."), help="Repository root"),
    base: str = typer.Option("main", help="Base git ref"),
    head: str = typer.Option("HEAD", help="Head git ref"),
    rules: Path = typer.Option(Path(".archsync/rules.yaml"), help="Rules config path"),
    output: Path = typer.Option(Path("docs/archsync/ci"), help="CI output directory"),
    fail_on: str = typer.Option("high", help="none|low|medium|high|critical"),
) -> None:
    repo = repo.resolve()
    output_dir = (repo / output).resolve() if not output.is_absolute() else output
    rules_path = (repo / rules).resolve() if not rules.is_absolute() else rules

    rules_config = _load_rules(rules_path)
    rules_for_diff = copy.deepcopy(rules_config)
    rules_for_diff.llm.enabled = False

    base_ref = resolve_ref(repo, base)
    head_ref = resolve_ref(repo, head)
    base_tree = materialize_ref(repo, base_ref)
    head_tree = materialize_ref(repo, head_ref)

    temp_state = Path(tempfile.mkdtemp(prefix="archsync-ci-state-")) / "state.db"
    base_build = run_build(
        repo_root=base_tree,
        rules=rules_for_diff,
        output_dir=output_dir / "base",
        state_db=temp_state,
        commit_id=base_ref[:8],
    )
    head_build = run_build(
        repo_root=head_tree,
        rules=rules_for_diff,
        output_dir=output_dir / "head",
        state_db=temp_state,
        commit_id=head_ref[:8],
    )

    files = changed_files(repo, base_ref, head_ref)
    report = build_diff_report(
        base_model=base_build.model,
        head_model=head_build.model,
        rules=rules_for_diff,
        changed_files=files,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    report_md = output_dir / "report.md"
    report_json = output_dir / "report.json"
    write_diff_markdown(report, report_md)
    write_diff_json(report, report_json)

    threshold = _severity_rank(fail_on)
    highest = max((_severity_rank(item.severity) for item in report.violations), default=0)
    if report.cycles:
        highest = max(highest, _severity_rank("critical"))

    typer.echo(f"[archsync] ci report: {report_md}")
    typer.echo(f"[archsync] highest severity: {highest}")
    if highest >= threshold and threshold > 0:
        typer.echo("[archsync] gate failed")
        raise typer.Exit(code=1)

    typer.echo("[archsync] gate passed")


@app.command()
def watch(
    repo: Path = typer.Option(Path("."), help="Repository root"),
    rules: Path = typer.Option(Path(".archsync/rules.yaml"), help="Rules config path"),
    output: Path = typer.Option(Path("docs/archsync"), help="Output directory"),
    state_db: Path = typer.Option(Path(".archsync/state.db"), help="SQLite state database"),
    interval: float = typer.Option(1.5, help="Polling interval in seconds"),
) -> None:
    repo = repo.resolve()
    rules_path = (repo / rules).resolve() if not rules.is_absolute() else rules
    output_dir = (repo / output).resolve() if not output.is_absolute() else output
    state_path = (repo / state_db).resolve() if not state_db.is_absolute() else state_db

    rules_config = _load_rules(rules_path)
    watch_loop(
        repo_root=repo,
        rules=rules_config,
        output_dir=output_dir,
        state_db=state_path,
        interval_seconds=interval,
    )


if __name__ == "__main__":
    app()
