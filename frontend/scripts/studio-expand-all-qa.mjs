#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const STUDIO_URL = process.env.STUDIO_URL || "http://127.0.0.1:5173/";
const OUT_DIR = process.env.OUT_DIR || path.join(repoRoot, "docs", "qa");
const VIEWPORT_WIDTH = Number(process.env.QA_VIEWPORT_WIDTH || 1900);
const VIEWPORT_HEIGHT = Number(process.env.QA_VIEWPORT_HEIGHT || 1080);

function safeStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function waitForModelLoaded(page) {
  await page.waitForFunction(
    () => {
      const nodes = document.querySelectorAll("svg.diagram g.node");
      return nodes.length > 0;
    },
    { timeout: 90_000 },
  );
}

async function evaluateContainerGeometry(page) {
  return page.evaluate(() => {
    function parseRect(group) {
      const rect = group.querySelector("rect.module-container-body");
      if (!rect) return null;
      const x = Number.parseFloat(rect.getAttribute("x") || "0");
      const y = Number.parseFloat(rect.getAttribute("y") || "0");
      const width = Number.parseFloat(rect.getAttribute("width") || "0");
      const height = Number.parseFloat(rect.getAttribute("height") || "0");
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
        return null;
      }
      return { x, y, width, height };
    }
    function parseNodeRect(group) {
      const rect = group.querySelector("rect.node-body");
      if (!rect) return null;
      const x = Number.parseFloat(rect.getAttribute("x") || "0");
      const y = Number.parseFloat(rect.getAttribute("y") || "0");
      const width = Number.parseFloat(rect.getAttribute("width") || "0");
      const height = Number.parseFloat(rect.getAttribute("height") || "0");
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
        return null;
      }
      return { x, y, width, height };
    }
    function parseHeaderRect(group) {
      const rect = group.querySelector("rect.hierarchy-chip-bg");
      if (!rect) return null;
      const x = Number.parseFloat(rect.getAttribute("x") || "0");
      const y = Number.parseFloat(rect.getAttribute("y") || "0");
      const width = Number.parseFloat(rect.getAttribute("width") || "0");
      const height = Number.parseFloat(rect.getAttribute("height") || "0");
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
        return null;
      }
      return { x, y, width, height };
    }
    function contains(outer, inner, pad = 0) {
      if (!outer || !inner) return false;
      return (
        inner.x >= outer.x + pad
        && inner.y >= outer.y + pad
        && inner.x + inner.width <= outer.x + outer.width - pad
        && inner.y + inner.height <= outer.y + outer.height - pad
      );
    }

    function overlapArea(a, b) {
      const x0 = Math.max(a.x, b.x);
      const y0 = Math.max(a.y, b.y);
      const x1 = Math.min(a.x + a.width, b.x + b.width);
      const y1 = Math.min(a.y + a.height, b.y + b.height);
      if (x1 <= x0 || y1 <= y0) return 0;
      return (x1 - x0) * (y1 - y0);
    }

    const bodyGroups = Array.from(document.querySelectorAll("g.module-container-body-layer"));
    const containers = [];
    for (const group of bodyGroups) {
      const id = String(group.getAttribute("data-id") || "");
      if (!id) continue;
      const parentId = String(group.getAttribute("data-parent-id") || "");
      const rect = parseRect(group);
      if (!rect) continue;
      containers.push({ id, parentId, ...rect });
    }
    const containerById = Object.fromEntries(containers.map((item) => [item.id, item]));

    const parentById = Object.fromEntries(containers.map((item) => [item.id, item.parentId || ""]));
    function isAncestor(candidateAncestorId, candidateDescendantId) {
      let current = candidateDescendantId;
      while (current) {
        if (current === candidateAncestorId) return true;
        current = parentById[current] || "";
      }
      return false;
    }

    const overlapViolations = [];
    for (let i = 0; i < containers.length; i += 1) {
      for (let j = i + 1; j < containers.length; j += 1) {
        const a = containers[i];
        const b = containers[j];
        if (isAncestor(a.id, b.id) || isAncestor(b.id, a.id)) {
          continue;
        }
        const area = overlapArea(a, b);
        if (area > 1) {
          overlapViolations.push({
            aId: a.id,
            bId: b.id,
            overlapArea: area,
          });
        }
      }
    }
    const containmentViolations = [];
    for (const container of containers) {
      if (!container.parentId) continue;
      const parent = containerById[container.parentId];
      if (!parent) continue;
      if (!contains(parent, container, -0.6)) {
        containmentViolations.push({
          id: container.id,
          parentId: container.parentId,
        });
      }
    }

    const headerGroups = Array.from(document.querySelectorAll("g.hierarchy-chip"));
    const headerContainmentViolations = [];
    for (const group of headerGroups) {
      const id = String(group.getAttribute("data-id") || "");
      if (!id) continue;
      const container = containerById[id];
      if (!container) continue;
      const header = parseHeaderRect(group);
      if (!header) continue;
      if (!contains(container, header, -0.8)) {
        headerContainmentViolations.push({ id });
      }
    }

    const nodeContainmentViolations = [];
    const nodeGroups = Array.from(document.querySelectorAll("svg.diagram g.node"));
    for (const group of nodeGroups) {
      const id = String(group.getAttribute("data-id") || "");
      const parentId = String(group.getAttribute("data-parent") || "");
      const nodeRect = parseNodeRect(group);
      if (!id || !nodeRect) continue;
      let current = parentId;
      let guard = 0;
      while (current && guard < 96) {
        const container = containerById[current];
        if (container && !contains(container, nodeRect, -0.6)) {
          nodeContainmentViolations.push({ nodeId: id, containerId: current });
          break;
        }
        current = parentById[current] || "";
        guard += 1;
      }
    }

    return {
      containerCount: containers.length,
      nodeCount: nodeGroups.length,
      overlapViolationCount: overlapViolations.length,
      overlapViolations,
      containmentViolationCount: containmentViolations.length,
      containmentViolations,
      headerContainmentViolationCount: headerContainmentViolations.length,
      headerContainmentViolations,
      nodeContainmentViolationCount: nodeContainmentViolations.length,
      nodeContainmentViolations,
    };
  });
}

async function getCollapsedExpandables(page) {
  return page.evaluate(() => {
    const items = [];
    for (const nodeGroup of Array.from(document.querySelectorAll("svg.diagram g.node.expandable"))) {
      const id = String(nodeGroup.getAttribute("data-id") || "");
      if (!id) continue;
      const toggleTextEl = nodeGroup.querySelector("g.node-expand-toggle text.expand-toggle-text");
      const toggleText = String(toggleTextEl?.textContent || "").trim();
      if (toggleText !== "+") {
        continue;
      }
      const levelText = String(nodeGroup.querySelector("text.meta")?.textContent || "");
      const levelMatch = levelText.match(/L(\d+)/);
      const level = levelMatch ? Number.parseInt(levelMatch[1], 10) : 0;
      const body = nodeGroup.querySelector("rect.node-body");
      const y = Number.parseFloat(body?.getAttribute("y") || "0");
      const x = Number.parseFloat(body?.getAttribute("x") || "0");
      const name = String(nodeGroup.querySelector("text.title")?.textContent || id).trim();
      items.push({ id, name, level, x, y });
    }
    items.sort((a, b) => (
      a.level - b.level
      || a.y - b.y
      || a.x - b.x
      || a.name.localeCompare(b.name)
    ));
    return items;
  });
}

async function clickExpandToggle(page, nodeId) {
  const toggle = page.locator(`svg.diagram g.node[data-id="${nodeId}"] g.node-expand-toggle`).first();
  await toggle.waitFor({ state: "visible", timeout: 20_000 });
  await toggle.click({ timeout: 20_000 });
}

async function main() {
  await ensureDir(OUT_DIR);
  const stamp = safeStamp();
  const runDir = path.join(OUT_DIR, `studio-expand-all-${stamp}`);
  await ensureDir(runDir);
  const shotsDir = path.join(runDir, "shots");
  await ensureDir(shotsDir);
  const reportPath = path.join(runDir, "report.json");
  const latestReportPath = path.join(OUT_DIR, "studio-expand-all-latest.json");

  const report = {
    startedAt: new Date().toISOString(),
    studioUrl: STUDIO_URL,
    runDir: path.relative(repoRoot, runDir),
    screenshots: [],
    expandSteps: [],
    violations: [],
    final: {},
  };

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } });

  try {
    await page.goto(STUDIO_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await waitForModelLoaded(page);

    const refreshButton = page.getByRole("button", { name: "Refresh" });
    if (await refreshButton.count()) {
      await refreshButton.click({ timeout: 30_000 });
      await waitForModelLoaded(page);
    }

    const zoomFitButton = page.getByRole("button", { name: "Zoom Fit" });
    if (await zoomFitButton.count()) {
      await zoomFitButton.click({ timeout: 10_000 });
      await page.waitForTimeout(240);
    }

    const seenExpandedIds = new Set();
    let step = 0;

    while (true) {
      const expandables = await getCollapsedExpandables(page);
      if (!expandables.length) {
        break;
      }

      const target = expandables.find((item) => !seenExpandedIds.has(item.id)) || expandables[0];
      if (!target) {
        break;
      }
      seenExpandedIds.add(target.id);

      step += 1;
      await clickExpandToggle(page, target.id);
      await page.waitForTimeout(260);

      if (await zoomFitButton.count()) {
        await zoomFitButton.click({ timeout: 10_000 });
        await page.waitForTimeout(260);
      }

      const shotPath = path.join(shotsDir, `${String(step).padStart(3, "0")}-expand-${target.id}.png`);
      await page.screenshot({ path: shotPath, fullPage: true });
      const geometry = await evaluateContainerGeometry(page);

      report.screenshots.push(path.relative(repoRoot, shotPath));
      report.expandSteps.push({
        step,
        expandedNodeId: target.id,
        expandedNodeName: normalizeText(target.name),
        expandedNodeLevel: target.level,
        containerCount: geometry.containerCount,
        overlapViolationCount: geometry.overlapViolationCount,
        containmentViolationCount: geometry.containmentViolationCount,
        headerContainmentViolationCount: geometry.headerContainmentViolationCount,
        nodeContainmentViolationCount: geometry.nodeContainmentViolationCount,
      });

      if (
        geometry.overlapViolationCount > 0
        || geometry.containmentViolationCount > 0
        || geometry.headerContainmentViolationCount > 0
        || geometry.nodeContainmentViolationCount > 0
      ) {
        report.violations.push({
          step,
          expandedNodeId: target.id,
          overlapViolations: geometry.overlapViolations,
          containmentViolations: geometry.containmentViolations,
          headerContainmentViolations: geometry.headerContainmentViolations,
          nodeContainmentViolations: geometry.nodeContainmentViolations,
        });
        break;
      }

      if (step > 400) {
        report.violations.push({
          step,
          error: "stopped due to safety cap (step > 400)",
        });
        break;
      }
    }

    const finalShot = path.join(runDir, "final-expanded.png");
    await page.screenshot({ path: finalShot, fullPage: true });
    const finalGeometry = await evaluateContainerGeometry(page);
    report.screenshots.push(path.relative(repoRoot, finalShot));
    report.final = {
      stepCount: step,
      containerCount: finalGeometry.containerCount,
      nodeCount: finalGeometry.nodeCount,
      overlapViolationCount: finalGeometry.overlapViolationCount,
      containmentViolationCount: finalGeometry.containmentViolationCount,
      headerContainmentViolationCount: finalGeometry.headerContainmentViolationCount,
      nodeContainmentViolationCount: finalGeometry.nodeContainmentViolationCount,
    };
    if (
      finalGeometry.overlapViolationCount > 0
      || finalGeometry.containmentViolationCount > 0
      || finalGeometry.headerContainmentViolationCount > 0
      || finalGeometry.nodeContainmentViolationCount > 0
    ) {
      report.violations.push({
        step: step + 1,
        expandedNodeId: "final",
        overlapViolations: finalGeometry.overlapViolations,
        containmentViolations: finalGeometry.containmentViolations,
        headerContainmentViolations: finalGeometry.headerContainmentViolations,
        nodeContainmentViolations: finalGeometry.nodeContainmentViolations,
      });
    }
  } catch (error) {
    report.violations.push({ step: -1, error: String(error?.stack || error) });
    throw error;
  } finally {
    await browser.close();
    report.finishedAt = new Date().toISOString();
    report.ok = report.violations.length === 0;
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await fs.copyFile(reportPath, latestReportPath);
  }

  process.stdout.write(`${path.relative(repoRoot, reportPath)}\n`);
}

await main();
