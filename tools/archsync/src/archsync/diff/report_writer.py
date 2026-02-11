from __future__ import annotations

from pathlib import Path

from archsync.schemas import DiffReport
from archsync.utils import write_json


def write_diff_json(report: DiffReport, output_path: Path) -> None:
    write_json(output_path, report.to_dict())


def write_diff_markdown(report: DiffReport, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    lines.append("# ArchSync Diff Report")
    lines.append("")
    lines.append(f"- Base: `{report.base_commit}`")
    lines.append(f"- Head: `{report.head_commit}`")
    lines.append(f"- Generated: `{report.generated_at}`")
    lines.append("")

    def section(title: str, items: list[str]) -> None:
        lines.append(f"## {title}")
        if not items:
            lines.append("- None")
        else:
            for item in items:
                lines.append(f"- {item}")
        lines.append("")

    section("Added Modules", report.added_modules)
    section("Removed Modules", report.removed_modules)
    section("Added Ports", report.added_ports)
    section("Removed Ports", report.removed_ports)
    section("Added Edges", report.added_edges)
    section("Removed Edges", report.removed_edges)

    lines.append("## Rule Violations")
    if not report.violations:
        lines.append("- None")
    else:
        for item in report.violations:
            lines.append(
                f"- [{item.severity}] `{item.rule}` {item.src_module} -> {item.dst_module}: {item.details}"
            )
    lines.append("")

    lines.append("## Cycles")
    if not report.cycles:
        lines.append("- None")
    else:
        for cycle in report.cycles:
            lines.append(f"- {' -> '.join(cycle)}")
    lines.append("")

    section("Changed Files", report.changed_files)

    output_path.write_text("\n".join(lines), encoding="utf-8")
