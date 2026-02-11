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
