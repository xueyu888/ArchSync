#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(frontendRoot, "..");
const qaDir = path.join(repoRoot, "docs", "qa");

const STUDIO_URL = process.env.STUDIO_URL || "http://127.0.0.1:5173/";
const DEFAULT_HOURS = Number(process.env.STUDIO_SOAK_HOURS || "8");
const DEFAULT_INTERVAL_SEC = Number(process.env.STUDIO_SOAK_INTERVAL_SEC || "20");
const STOP_ON_FAILURE = process.env.STUDIO_SOAK_STOP_ON_FAILURE !== "0";

function isoCompact(value = new Date()) {
  return value.toISOString().replace(/[:.]/g, "-");
}

function parseArgs(argv) {
  const out = {
    hours: DEFAULT_HOURS,
    intervalSec: DEFAULT_INTERVAL_SEC,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--hours" && argv[i + 1]) {
      out.hours = Number(argv[i + 1]);
      i += 1;
    } else if (token === "--interval-sec" && argv[i + 1]) {
      out.intervalSec = Number(argv[i + 1]);
      i += 1;
    } else if (token === "--url" && argv[i + 1]) {
      out.url = String(argv[i + 1]);
      i += 1;
    }
  }
  if (!Number.isFinite(out.hours) || out.hours <= 0) out.hours = DEFAULT_HOURS;
  if (!Number.isFinite(out.intervalSec) || out.intervalSec < 0) out.intervalSec = DEFAULT_INTERVAL_SEC;
  return out;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

async function isUrlReachable(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    return response.ok || response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForReachable(url, timeoutMs = 90_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isUrlReachable(url)) {
      return true;
    }
    await sleep(600);
  }
  return false;
}

function spawnWithCapture(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code, signal) => {
      resolve({
        code: Number.isFinite(code) ? code : -1,
        signal: signal || "",
        stdout,
        stderr,
      });
    });
  });
}

function parseReportPathFromOutput(stdout) {
  const lines = String(stdout || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line.endsWith(".json")) {
      return line;
    }
  }
  return "";
}

function normalizeReportPath(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(repoRoot, raw);
}

async function readJsonSafe(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractStudioE2EFailures(report) {
  const failures = [];
  if (!report || typeof report !== "object") {
    failures.push("missing e2e report");
    return failures;
  }
  const hardLists = [
    ["metrics", "containmentViolations"],
    ["metrics", "headerContainmentViolations"],
    ["hierarchy_metrics", "containmentViolations"],
    ["hierarchy_metrics", "headerContainmentViolations"],
    ["resize_smoke_metrics", "containmentViolations"],
    ["resize_smoke_metrics", "headerContainmentViolations"],
    ["container_resize_smoke_metrics", "containmentViolations"],
    ["container_resize_smoke_metrics", "headerContainmentViolations"],
  ];
  for (const [group, key] of hardLists) {
    const value = report?.[group]?.[key];
    if (Array.isArray(value) && value.length > 0) {
      failures.push(`${group}.${key}=${value.length}`);
    }
  }
  const intersections = Number(report?.metrics?.edgeNodeIntersectionCount || 0);
  if (intersections > 0) {
    failures.push(`metrics.edgeNodeIntersectionCount=${intersections}`);
  }
  if (Array.isArray(report?.failures) && report.failures.length > 0) {
    failures.push(`report.failures=${report.failures.length}`);
  }
  return failures;
}

function extractExpandAllFailures(report) {
  const failures = [];
  if (!report || typeof report !== "object") {
    failures.push("missing expand-all report");
    return failures;
  }
  if (report.ok === false) {
    failures.push("expand-all report ok=false");
  }
  if (Array.isArray(report.violations) && report.violations.length > 0) {
    failures.push(`expand-all violations=${report.violations.length}`);
  }
  const final = report.final || {};
  if (Number(final.overlapViolationCount || 0) > 0) {
    failures.push(`expand-all final overlap=${final.overlapViolationCount}`);
  }
  if (Number(final.containmentViolationCount || 0) > 0) {
    failures.push(`expand-all final containment=${final.containmentViolationCount}`);
  }
  if (Number(final.headerContainmentViolationCount || 0) > 0) {
    failures.push(`expand-all final headerContainment=${final.headerContainmentViolationCount}`);
  }
  if (Number(final.nodeContainmentViolationCount || 0) > 0) {
    failures.push(`expand-all final nodeContainment=${final.nodeContainmentViolationCount}`);
  }
  return failures;
}

async function runOne(scriptFile, env = {}) {
  const startedAt = Date.now();
  const result = await spawnWithCapture("node", [scriptFile], {
    cwd: frontendRoot,
    env,
  });
  const durationMs = Date.now() - startedAt;
  const outputPath = parseReportPathFromOutput(result.stdout);
  const absoluteReportPath = normalizeReportPath(outputPath);
  const reportJson = absoluteReportPath ? await readJsonSafe(absoluteReportPath) : null;
  return {
    code: result.code,
    signal: result.signal,
    durationMs,
    stdout: result.stdout,
    stderr: result.stderr,
    outputPath,
    absoluteReportPath,
    reportJson,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runStamp = isoCompact();
  const soakReportPath = path.join(qaDir, `studio-soak-${runStamp}.json`);
  const latestSoakPath = path.join(qaDir, "studio-soak-latest.json");
  const runMeta = {
    startedAt: nowIso(),
    studioUrl: args.url || STUDIO_URL,
    config: {
      hours: args.hours,
      intervalSec: args.intervalSec,
      stopOnFailure: STOP_ON_FAILURE,
    },
    iterations: [],
    failures: [],
  };

  await ensureDir(qaDir);

  let devServer = null;
  let startedDevServer = false;
  const studioUrl = args.url || STUDIO_URL;
  const reachable = await isUrlReachable(studioUrl);
  if (!reachable) {
    devServer = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], {
      cwd: frontendRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    startedDevServer = true;
    devServer.stdout?.on("data", () => {});
    devServer.stderr?.on("data", () => {});
    const ready = await waitForReachable(studioUrl, 120_000);
    if (!ready) {
      runMeta.failures.push("cannot reach studio url");
      runMeta.finishedAt = nowIso();
      await fs.writeFile(soakReportPath, `${JSON.stringify(runMeta, null, 2)}\n`, "utf8");
      await fs.copyFile(soakReportPath, latestSoakPath);
      process.stdout.write(`${path.relative(repoRoot, soakReportPath)}\n`);
      process.exit(1);
    }
  }

  const durationMs = Math.max(1000, args.hours * 3600 * 1000);
  const endAt = Date.now() + durationMs;
  let iteration = 0;

  try {
    while (Date.now() < endAt) {
      iteration += 1;
      const iter = {
        index: iteration,
        startedAt: nowIso(),
        e2e: null,
        expandAll: null,
        failures: [],
      };

      const e2e = await runOne(path.join("scripts", "studio-e2e.mjs"), { STUDIO_URL: studioUrl });
      const e2eFailures = [];
      if (e2e.code !== 0) {
        e2eFailures.push(`studio-e2e exit=${e2e.code}`);
      }
      e2eFailures.push(...extractStudioE2EFailures(e2e.reportJson));
      iter.e2e = {
        exitCode: e2e.code,
        durationMs: e2e.durationMs,
        reportPath: e2e.outputPath || "",
        failures: e2eFailures,
      };

      const expand = await runOne(path.join("scripts", "studio-expand-all-qa.mjs"), { STUDIO_URL: studioUrl });
      const expandFailures = [];
      if (expand.code !== 0) {
        expandFailures.push(`studio-expand-all-qa exit=${expand.code}`);
      }
      expandFailures.push(...extractExpandAllFailures(expand.reportJson));
      iter.expandAll = {
        exitCode: expand.code,
        durationMs: expand.durationMs,
        reportPath: expand.outputPath || "",
        failures: expandFailures,
      };

      iter.failures = [...e2eFailures, ...expandFailures];
      iter.finishedAt = nowIso();
      runMeta.iterations.push(iter);
      if (iter.failures.length > 0) {
        runMeta.failures.push({ iteration, failures: iter.failures });
        if (STOP_ON_FAILURE) {
          break;
        }
      }

      await fs.writeFile(soakReportPath, `${JSON.stringify(runMeta, null, 2)}\n`, "utf8");
      await fs.copyFile(soakReportPath, latestSoakPath);

      if (Date.now() + args.intervalSec * 1000 >= endAt) {
        break;
      }
      if (args.intervalSec > 0) {
        await sleep(args.intervalSec * 1000);
      }
    }
  } finally {
    if (startedDevServer && devServer) {
      devServer.kill("SIGTERM");
    }
  }

  runMeta.finishedAt = nowIso();
  runMeta.ok = runMeta.failures.length === 0;
  await fs.writeFile(soakReportPath, `${JSON.stringify(runMeta, null, 2)}\n`, "utf8");
  await fs.copyFile(soakReportPath, latestSoakPath);
  process.stdout.write(`${path.relative(repoRoot, soakReportPath)}\n`);
  if (!runMeta.ok) {
    process.exit(1);
  }
}

await main();
