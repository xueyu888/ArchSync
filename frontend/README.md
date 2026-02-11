# ArchSync Frontend

React application for interactive architecture analysis.

## Features

- Unlimited drill-down architecture tree (left click module to enter child level until leaf)
- Module search/filter and edge-type toggles
- Stable deterministic edge aggregation per current depth view
- PlantUML-like architecture canvas style (orthogonal wiring + lane grouping)
- Drag-and-drop module arrangement per depth view (with one-click auto layout reset)
- Visible links strip with endpoint/protocol labels
- Click-to-focus module details (ports, incoming/outgoing links)
- Interface details with protocol, parser detail, and evidence file:line
- Trigger ArchSync build/diff/ci directly from UI
- Show diff summary and CI gate result

## Run

Start backend first:

```bash
cd ../backend
uv sync --extra dev
uv run uvicorn main:app --reload --host 127.0.0.1 --port 9000
```

Then start frontend:

```bash
cd ../frontend
npm install
npm run dev
```

Open: `http://127.0.0.1:5173`
