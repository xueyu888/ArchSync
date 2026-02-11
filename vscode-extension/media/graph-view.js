const vscode = acquireVsCodeApi();
let state = null;

const canvas = document.getElementById('canvas');
const crumbs = document.getElementById('crumbs');
const meta = document.getElementById('meta');
const details = document.getElementById('details');

function post(type, payload = {}) {
  vscode.postMessage({ type, ...payload });
}

function esc(text) {
  return String(text || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function layout(nodes) {
  const groups = new Map();
  for (const node of nodes) {
    if (!groups.has(node.layer)) {
      groups.set(node.layer, []);
    }
    groups.get(node.layer).push(node);
  }

  const layers = Array.from(groups.keys());
  const laneWidth = 280;
  const laneGap = 56;
  const nodeWidth = 220;
  const top = 56;
  const left = 36;
  const nodesOut = [];
  const lanes = [];
  let maxHeight = 420;

  for (let col = 0; col < layers.length; col += 1) {
    const layer = layers[col];
    const laneX = left + col * (laneWidth + laneGap);
    let y = top + 30;

    const list = [...groups.get(layer)].sort((a, b) => a.name.localeCompare(b.name));
    for (const node of list) {
      const height = node.summary ? 108 : 88;
      nodesOut.push({ ...node, x: laneX + (laneWidth - nodeWidth) / 2, y, width: nodeWidth, height });
      y += height + 24;
    }

    lanes.push({ layer, x: laneX, y: top, width: laneWidth, height: Math.max(280, y - top + 12) });
    maxHeight = Math.max(maxHeight, y + 20);
  }

  return {
    width: left + Math.max(1, layers.length) * laneWidth + Math.max(0, layers.length - 1) * laneGap + 44,
    height: maxHeight,
    lanes,
    nodes: nodesOut,
  };
}

function edgePath(src, dst) {
  const leftToRight = src.x <= dst.x;
  const startX = leftToRight ? src.x + src.width - 8 : src.x + 8;
  const endX = leftToRight ? dst.x + 8 : dst.x + dst.width - 8;
  const startY = src.y + src.height / 2;
  const endY = dst.y + dst.height / 2;
  const midX = (startX + endX) / 2;
  return `M ${startX} ${startY} L ${midX} ${startY} L ${midX} ${endY} L ${endX} ${endY}`;
}

function render() {
  if (!state || !state.ready) {
    canvas.innerHTML = '<div class="empty">No model found. Run ArchSync build first.</div>';
    crumbs.innerHTML = '';
    meta.textContent = 'no model';
    details.innerHTML = '<p>先运行 Build 生成模型</p>';
    return;
  }

  const graph = layout(state.nodes || []);
  const byId = Object.fromEntries(graph.nodes.map((item) => [item.id, item]));

  const laneHtml = graph.lanes
    .map((lane) => `<div class="lane-label" style="left:${lane.x + 8}px;top:${lane.y + 8}px">${esc(lane.layer)}</div>`)
    .join('');

  const edgeHtml = (state.edges || [])
    .map((edge) => {
      const src = byId[edge.src_id];
      const dst = byId[edge.dst_id];
      if (!src || !dst) {
        return '';
      }
      const color = edge.kind === 'interface' ? 'var(--edge-intf)' : 'var(--edge)';
      const path = edgePath(src, dst);
      return `<path d="${path}" fill="none" stroke="${color}" stroke-width="${1.8 + Math.min(1.6, (edge.count || 1) * 0.2)}"/>`;
    })
    .join('');

  const nodeHtml = graph.nodes
    .map((node) => {
      const cls = ['node'];
      if (node.selected) cls.push('selected');
      if (node.highlighted) cls.push('highlight');

      const hint = node.canDrill ? '左键下钻' : node.hasSource ? '左键打开源码' : '无源码映射';
      return `<button class="${cls.join(' ')}" data-id="${esc(node.id)}" style="left:${node.x}px;top:${node.y}px;height:${node.height}px">
        <h4>${esc(node.name)}</h4>
        <p>${esc(node.layer)} · L${node.level}</p>
        ${node.summary ? `<p class="summary">${esc(node.summary)}</p>` : ''}
        <p class="hint">${esc(hint)}</p>
      </button>`;
    })
    .join('');

  canvas.innerHTML = `
    <div class="diagram" style="width:${graph.width}px;height:${graph.height}px">
      ${laneHtml}
      <svg width="${graph.width}" height="${graph.height}">${edgeHtml}</svg>
      ${nodeHtml}
    </div>`;

  canvas.querySelectorAll('.node').forEach((el) => {
    el.addEventListener('click', () => {
      const moduleId = el.getAttribute('data-id');
      const node = (state.nodes || []).find((item) => item.id === moduleId);
      post('select', { moduleId });
      if (!node) {
        return;
      }
      if (node.canDrill) {
        post('drill', { moduleId });
        return;
      }
      if (node.hasSource) {
        post('openModule', { moduleId });
      }
    });
  });

  crumbs.innerHTML = (state.breadcrumb || [])
    .map(
      (item, index) =>
        `${index > 0 ? '<span class="sep">/</span>' : ''}<button class="crumb" data-id="${esc(item.id)}">${esc(item.name)}</button>`,
    )
    .join('');
  crumbs.querySelectorAll('.crumb').forEach((el) => {
    el.addEventListener('click', () => {
      post('jump', { moduleId: el.getAttribute('data-id') });
    });
  });

  meta.textContent = `Depth ${state.currentDepth} · ${state.nodes.length} modules · ${state.edges.length} links`;

  if (state.selected) {
    const sourceClass = state.selected.summarySource === 'llm' ? 'llm' : 'fallback';
    const sourceText = state.selected.summarySource === 'llm' ? 'Local LLM' : 'Fallback';
    details.innerHTML = `
      <h4>${esc(state.selected.name)}</h4>
      <p>${esc(state.selected.layer)} · L${state.selected.level} · ${esc(state.selected.path || '/')}</p>
      ${state.selected.summary ? `<p>${esc(state.selected.summary)}</p>` : '<p>无说明</p>'}
      <span class="source-pill ${sourceClass}">${sourceText}</span>
    `;
  } else {
    details.innerHTML = '<p>选择节点查看说明并联动代码</p>';
  }
}

document.getElementById('refresh').addEventListener('click', () => post('refresh'));
document.getElementById('up').addEventListener('click', () => post('up'));
document.getElementById('open-selected').addEventListener('click', () => {
  if (state?.selected?.id) {
    post('openModule', { moduleId: state.selected.id });
  }
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.type === 'state') {
    state = message.payload;
    render();
  }
});
