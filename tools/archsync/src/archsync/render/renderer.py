from __future__ import annotations

import html
import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

from archsync.config import RulesConfig
from archsync.schemas import ArchitectureEdge, ArchitectureModel, ModuleNode, PortNode
from archsync.utils import write_json


@dataclass(slots=True)
class DrawNode:
    id: str
    name: str
    layer: str
    x: int
    y: int
    width: int
    height: int
    ports_in: list[PortNode]
    ports_out: list[PortNode]


def _collect_views(model: ArchitectureModel) -> dict[str, tuple[list[ModuleNode], list[ArchitectureEdge]]]:
    by_id = {item.id: item for item in model.modules}

    l0_nodes = [item for item in model.modules if item.level == 1]
    l1_nodes = [item for item in model.modules if item.level == 2]
    l2_nodes = [item for item in model.modules if item.level == 3]

    l0_edges_map: dict[tuple[str, str], ArchitectureEdge] = {}
    for edge in model.edges:
        src = by_id.get(edge.src_id)
        dst = by_id.get(edge.dst_id)
        if not src or not dst:
            continue
        src_layer_node = next((item for item in model.modules if item.level == 1 and item.name == src.layer), None)
        dst_layer_node = next((item for item in model.modules if item.level == 1 and item.name == dst.layer), None)
        if not src_layer_node or not dst_layer_node or src_layer_node.id == dst_layer_node.id:
            continue
        key = (src_layer_node.id, dst_layer_node.id)
        if key not in l0_edges_map:
            l0_edges_map[key] = ArchitectureEdge(
                id=f"l0-{src_layer_node.id}-{dst_layer_node.id}",
                src_id=src_layer_node.id,
                dst_id=dst_layer_node.id,
                kind="dependency",
                label=f"{src.layer} -> {dst.layer}",
                evidence_ids=[],
            )

    l1_edges = [item for item in model.edges if item.kind in {"dependency", "interface"}]
    l2_edges = [item for item in model.edges if item.kind == "dependency_file"]

    return {
        "l0": (l0_nodes, list(l0_edges_map.values())),
        "l1": (l1_nodes, l1_edges),
        "l2": (l2_nodes, l2_edges),
    }


def _layout_nodes(nodes: list[ModuleNode], ports_by_module: dict[str, list[PortNode]]) -> list[DrawNode]:
    groups: dict[str, list[ModuleNode]] = defaultdict(list)
    for node in nodes:
        groups[node.layer].append(node)

    ordered_layers = list(groups.keys())
    draw_nodes: list[DrawNode] = []
    width = 280
    base_height = 70
    margin_left = 30
    margin_top = 30
    col_gap = 120
    row_gap = 40

    for col, layer in enumerate(ordered_layers):
        x = margin_left + col * (width + col_gap)
        y = margin_top
        for node in sorted(groups[layer], key=lambda item: item.name):
            ports = ports_by_module.get(node.id, [])
            ports_in = [item for item in ports if item.direction.lower() == "in"]
            ports_out = [item for item in ports if item.direction.lower() == "out"]
            max_port_lines = max(len(ports_in), len(ports_out))
            height = base_height + max_port_lines * 20
            draw_nodes.append(
                DrawNode(
                    id=node.id,
                    name=node.name,
                    layer=node.layer,
                    x=x,
                    y=y,
                    width=width,
                    height=height,
                    ports_in=ports_in,
                    ports_out=ports_out,
                )
            )
            y += height + row_gap

    return draw_nodes


def _svg_for_view(
    view_name: str,
    nodes: list[ModuleNode],
    edges: list[ArchitectureEdge],
    ports_by_module: dict[str, list[PortNode]],
) -> str:
    draw_nodes = _layout_nodes(nodes, ports_by_module)
    node_lookup = {item.id: item for item in draw_nodes}

    max_x = max((item.x + item.width for item in draw_nodes), default=800) + 80
    max_y = max((item.y + item.height for item in draw_nodes), default=500) + 80

    lines: list[str] = []
    lines.append(
        f'<svg class="archsync-svg" data-view="{view_name}" xmlns="http://www.w3.org/2000/svg" width="{max_x}" height="{max_y}" viewBox="0 0 {max_x} {max_y}">'
    )
    lines.append(
        "<defs><marker id='arrow' markerWidth='10' markerHeight='8' refX='9' refY='4' orient='auto'><polygon points='0,0 10,4 0,8' fill='#3b4f72'/></marker></defs>"
    )

    for edge in edges:
        src = node_lookup.get(edge.src_id)
        dst = node_lookup.get(edge.dst_id)
        if not src or not dst:
            continue
        x1 = src.x + src.width
        y1 = src.y + src.height // 2
        x2 = dst.x
        y2 = dst.y + dst.height // 2
        color = "#3b4f72"
        if edge.kind == "interface":
            color = "#007f5f"
        if edge.kind == "dependency_file":
            color = "#9c6644"

        lines.append(
            f"<line class='edge edge-{edge.kind}' data-src='{html.escape(edge.src_id)}' data-dst='{html.escape(edge.dst_id)}' x1='{x1}' y1='{y1}' x2='{x2}' y2='{y2}' stroke='{color}' stroke-width='2' marker-end='url(#arrow)' />"
        )
        label_x = (x1 + x2) // 2
        label_y = (y1 + y2) // 2 - 6
        lines.append(
            f"<text x='{label_x}' y='{label_y}' class='edge-label'>{html.escape(edge.label[:40])}</text>"
        )

    for node in draw_nodes:
        lines.append(
            f"<g class='module-node' data-module-id='{html.escape(node.id)}' data-layer='{html.escape(node.layer)}'>"
        )
        lines.append(
            f"<rect x='{node.x}' y='{node.y}' width='{node.width}' height='{node.height}' rx='12' ry='12' class='module-rect layer-{html.escape(node.layer.lower())}' />"
        )
        lines.append(
            f"<text x='{node.x + 12}' y='{node.y + 24}' class='module-title'>{html.escape(node.name)}</text>"
        )
        lines.append(
            f"<text x='{node.x + 12}' y='{node.y + 44}' class='module-layer'>Layer: {html.escape(node.layer)}</text>"
        )

        for idx, port in enumerate(node.ports_in):
            y = node.y + 62 + idx * 20
            lines.append(f"<circle cx='{node.x + 8}' cy='{y - 4}' r='4' fill='#007f5f' />")
            lines.append(
                f"<text x='{node.x + 16}' y='{y}' class='port-label'>IN {html.escape(port.name[:28])}</text>"
            )

        for idx, port in enumerate(node.ports_out):
            y = node.y + 62 + idx * 20
            tx = node.x + node.width - 14
            lines.append(f"<circle cx='{tx}' cy='{y - 4}' r='4' fill='#e85d04' />")
            lines.append(
                f"<text text-anchor='end' x='{tx - 8}' y='{y}' class='port-label'>OUT {html.escape(port.name[:28])}</text>"
            )

        lines.append("</g>")

    lines.append("</svg>")
    return "\n".join(lines)


def _html_page(
    model: ArchitectureModel,
    views: dict[str, str],
    ports_by_module: dict[str, list[PortNode]],
) -> str:
    modules_for_panel = [
        {
            "id": item.id,
            "name": item.name,
            "layer": item.layer,
            "level": item.level,
            "ports": [
                {
                    "name": port.name,
                    "direction": port.direction,
                    "protocol": port.protocol,
                    "details": port.details,
                }
                for port in ports_by_module.get(item.id, [])
            ],
        }
        for item in model.modules
        if item.level in {1, 2, 3}
    ]

    payload = {
        "modules": modules_for_panel,
        "edges": [item.to_dict() for item in model.edges],
    }

    css = """
:root {
  --bg: #f6f8fb;
  --panel: #ffffff;
  --line: #d8e0ea;
  --text: #102a43;
  --muted: #627d98;
  --accent: #007f5f;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
  color: var(--text);
  background: radial-gradient(circle at top right, #dde8f5 0%, var(--bg) 45%);
}
.app {
  display: grid;
  grid-template-columns: 330px 1fr;
  min-height: 100vh;
}
.sidebar {
  padding: 20px;
  border-right: 1px solid var(--line);
  background: linear-gradient(180deg, #ffffff, #f7fafc);
  overflow: auto;
}
.sidebar h1 {
  margin: 0 0 10px;
  font-size: 20px;
}
.sidebar .meta {
  color: var(--muted);
  margin-bottom: 18px;
  font-size: 13px;
}
.view-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}
.view-tabs button {
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
}
.view-tabs button.active {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 700;
}
.module-list {
  max-height: 38vh;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
}
.module-item {
  display: block;
  width: 100%;
  border: none;
  border-bottom: 1px solid #eef2f6;
  text-align: left;
  background: transparent;
  padding: 8px 10px;
  cursor: pointer;
}
.module-item:last-child { border-bottom: none; }
.module-item span {
  display: block;
  color: var(--muted);
  font-size: 12px;
}
.details {
  margin-top: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
  padding: 10px;
  min-height: 180px;
}
.main {
  overflow: auto;
  padding: 14px;
}
.view {
  display: none;
}
.view.active {
  display: block;
}
.archsync-svg {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 10px;
}
.module-rect {
  fill: #f8fbff;
  stroke: #3b4f72;
  stroke-width: 1.4;
}
.module-node.active .module-rect {
  stroke: #e85d04;
  stroke-width: 2.4;
  fill: #fff8f3;
}
.module-title {
  font-size: 13px;
  font-weight: 600;
}
.module-layer, .port-label, .edge-label {
  font-size: 11px;
  fill: #486581;
}
.edge {
  opacity: 0.25;
}
.edge.highlight {
  opacity: 1;
  stroke-width: 3;
}
@media (max-width: 980px) {
  .app { grid-template-columns: 1fr; }
  .sidebar { border-right: none; border-bottom: 1px solid var(--line); }
}
"""

    js = """
const payload = JSON.parse(document.getElementById('archsync-data').textContent);
let activeView = 'l1';
let activeModule = null;

function setView(view) {
  activeView = view;
  document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
  document.querySelector(`#view-${view}`).classList.add('active');
  document.querySelectorAll('.view-tabs button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  bindSvgInteractions();
  if (activeModule) {
    selectModule(activeModule);
  }
}

function renderModuleList() {
  const container = document.querySelector('.module-list');
  const items = payload.modules
    .sort((a, b) => (a.layer + a.name).localeCompare(b.layer + b.name))
    .map((module) => `
      <button class="module-item" data-module-id="${module.id}">
        ${module.name}
        <span>${module.layer} · L${module.level}</span>
      </button>
    `);
  container.innerHTML = items.join('');

  container.querySelectorAll('.module-item').forEach((el) => {
    el.addEventListener('click', () => {
      selectModule(el.dataset.moduleId);
    });
  });
}

function bindSvgInteractions() {
  document.querySelectorAll(`#view-${activeView} .module-node`).forEach((el) => {
    el.addEventListener('click', () => {
      selectModule(el.dataset.moduleId);
    });
  });
}

function selectModule(moduleId) {
  activeModule = moduleId;
  const module = payload.modules.find((item) => item.id === moduleId);
  if (!module) return;

  document.querySelectorAll('.module-node').forEach((el) => {
    el.classList.toggle('active', el.dataset.moduleId === moduleId);
  });

  document.querySelectorAll('.edge').forEach((edge) => {
    const linked = edge.dataset.src === moduleId || edge.dataset.dst === moduleId;
    edge.classList.toggle('highlight', linked);
  });

  const lines = [];
  lines.push(`<h3 style="margin:0 0 8px">${module.name}</h3>`);
  lines.push(`<div style="font-size:12px;color:#627d98">Layer: ${module.layer} · Level: ${module.level}</div>`);

  if (!module.ports.length) {
    lines.push('<p style="font-size:13px">No ports detected.</p>');
  } else {
    lines.push('<ul style="padding-left:16px">');
    module.ports.forEach((port) => {
      lines.push(`<li><strong>${port.direction.toUpperCase()}</strong> ${port.protocol} ${port.name}<br/><span style="color:#627d98">${port.details}</span></li>`);
    });
    lines.push('</ul>');
  }

  document.querySelector('.details').innerHTML = lines.join('');
}

renderModuleList();
setView('l1');
bindSvgInteractions();
"""

    return f"""<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
  <title>ArchSync Dashboard</title>
  <style>{css}</style>
</head>
<body>
  <div class=\"app\">
    <aside class=\"sidebar\">
      <h1>{html.escape(model.system_name)} Diagram Console</h1>
      <div class=\"meta\">commit: {html.escape(model.commit_id)}<br/>generated: {html.escape(model.generated_at)}</div>
      <div class=\"view-tabs\">
        <button data-view=\"l0\">L0</button>
        <button data-view=\"l1\">L1</button>
        <button data-view=\"l2\">L2</button>
      </div>
      <div class=\"module-list\"></div>
      <div class=\"details\">Click a module to inspect ports and connections.</div>
    </aside>
    <main class=\"main\">
      <section id=\"view-l0\" class=\"view\">{views['l0']}</section>
      <section id=\"view-l1\" class=\"view\">{views['l1']}</section>
      <section id=\"view-l2\" class=\"view\">{views['l2']}</section>
    </main>
  </div>

  <script id=\"archsync-data\" type=\"application/json\">{json.dumps(payload, ensure_ascii=False)}</script>
  <script>{js}</script>
  <script>
    document.querySelectorAll('.view-tabs button').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.view)));
  </script>
</body>
</html>
"""


def render_outputs(model: ArchitectureModel, rules: RulesConfig, output_dir: Path) -> dict[str, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    views_dir = output_dir / "views"
    views_dir.mkdir(parents=True, exist_ok=True)

    ports_by_module: dict[str, list[PortNode]] = defaultdict(list)
    for port in model.ports:
        ports_by_module[port.module_id].append(port)

    views_input = _collect_views(model)
    views_svg: dict[str, str] = {}
    for key, (nodes, edges) in views_input.items():
        svg = _svg_for_view(key, nodes, edges, ports_by_module)
        views_svg[key] = svg
        (views_dir / f"{key}.svg").write_text(svg, encoding="utf-8")

    index_html = _html_page(model, views_svg, ports_by_module)
    (output_dir / "index.html").write_text(index_html, encoding="utf-8")
    write_json(output_dir / "architecture.model.json", model.to_dict())

    return {
        "dashboard": output_dir / "index.html",
        "model_json": output_dir / "architecture.model.json",
        "l0_svg": views_dir / "l0.svg",
        "l1_svg": views_dir / "l1.svg",
        "l2_svg": views_dir / "l2.svg",
    }
