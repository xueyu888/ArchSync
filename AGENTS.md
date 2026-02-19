# Engineering Philosophy (global default)

Build software like hardware, reason about it like math.

1) Composition over inheritance. Prefer small, composable units with clear interfaces.
2) Make boundaries real: modules interact only through their public API; no backdoors.
3) Control side effects: keep IO/DB/network/time/random at the edges; keep the core deterministic when possible.
4) Make state explicit and owned: avoid hidden globals; one owner per piece of state; explicit state transitions.
5) Enforce invariants: define “illegal states” and make them impossible or caught at boundaries; fail fast with clear errors.
6) One-way dependencies: stable core must not depend on volatile infra; depend on abstractions, not details.
7) Optimize for change: small diffs, consistent naming, simple data flow; refactor incrementally with tests.
8) When uncertain: write a minimal failing test or a runtime check before changing behavior; document assumptions.

Default workflow for any task:
- Read the repo structure and follow existing conventions unless they violate the principles above.
- Propose the smallest safe change that improves clarity and keeps behavior stable.
- Add/adjust tests for invariants and edge cases.
- Explain trade-offs explicitly when a principle can’t be fully met.

## Studio UI Hard Constraints (must hold)

These constraints are mandatory for every change touching `frontend/src/App.jsx`, `frontend/src/App.css`,
`frontend/src/studio/helpers.js`, `frontend/src/studio/container-layout.js`, or edge/container rendering logic.

1) Containment is hard:
- After expand/collapse/drag/resize, every visible child node must be inside all visible ancestor frames.
- Frame headers/chips must stay inside their frame bounds.
- No visual case where "expanded content runs outside parent frame".

2) Manual interaction stability:
- Dragging/resizing one frame/node must not cause unrelated frames to jump, reflow, or snap back.
- Manual edits must be local and deterministic.
- Existing manual positions from local storage must not break containment invariants.

3) Edge interaction clarity:
- Selecting a frame must make related edges visually emphasized and non-related edges dimmed.
- Edges must be selectable from the canvas (hitbox + visible stroke).
- Edge style baseline: solid and thin; no dashed dependency lines.

4) Z-order/readability:
- Edges and frames must remain readable and not produce node-crossing artifacts.
- Border connectors for cross-frame edges must remain visible at boundaries.

## Studio UI Required Verification (run every time)

Before finishing any Studio UI change, always run all of:

1. `npm run lint` (in `frontend/`)
2. `npm run build` (in `frontend/`)
3. `node scripts/studio-e2e.mjs` (in `frontend/`)

And then verify:
- `docs/qa/studio-ui-regression-latest.json` has `failures: []`.
- `containmentViolations`, `headerContainmentViolations`, and `edgeNodeIntersectionCount` are zero in the latest report.
- visually inspect `docs/qa/studio-ui-regression-latest-overview.png`, `docs/qa/studio-ui-regression-latest-hierarchy.png`, and `docs/qa/studio-ui-regression-latest-stress.png` for containment and edge readability.
