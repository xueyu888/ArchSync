const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const detail = typeof payload === "string" ? payload : JSON.stringify(payload);
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }
  return payload;
}

async function apiGet(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    url.searchParams.set(key, String(value));
  });

  const response = await fetch(url);
  return parseResponse(response);
}

async function apiPost(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return parseResponse(response);
}

export function healthCheck() {
  return apiGet("/api/health");
}

export function fetchModel(options = {}) {
  return apiGet("/api/archsync/model", {
    repo_path: options.repoPath ?? ".",
    output_path: options.outputPath ?? "docs/archsync",
    auto_build: options.autoBuild ?? true,
  });
}

export function buildArchitecture(options = {}) {
  return apiPost("/api/archsync/build", {
    repo_path: options.repoPath ?? ".",
    rules_path: options.rulesPath ?? ".archsync/rules.yaml",
    output_path: options.outputPath ?? "docs/archsync",
    state_db_path: options.stateDbPath ?? ".archsync/state.db",
    commit_id: options.commitId ?? null,
    full: options.full ?? true,
  });
}

export function diffArchitecture(options = {}) {
  return apiPost("/api/archsync/diff", {
    repo_path: options.repoPath ?? ".",
    base: options.base ?? "main",
    head: options.head ?? "HEAD",
    rules_path: options.rulesPath ?? ".archsync/rules.yaml",
    output_path: options.outputPath ?? "docs/archsync/diff",
  });
}

export function runCIGate(options = {}) {
  return apiPost("/api/archsync/ci", {
    repo_path: options.repoPath ?? ".",
    base: options.base ?? "main",
    head: options.head ?? "HEAD",
    rules_path: options.rulesPath ?? ".archsync/rules.yaml",
    output_path: options.outputPath ?? "docs/archsync/ci",
    fail_on: options.failOn ?? "high",
  });
}
