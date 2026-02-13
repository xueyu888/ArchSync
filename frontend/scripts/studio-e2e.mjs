#!/usr/bin/env node
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const STUDIO_URL = process.env.STUDIO_URL || "http://127.0.0.1:5173/";
const OUT_DIR = process.env.OUT_DIR || path.join(repoRoot, "docs", "qa");

function isoStamp() {
  // 2026-02-12T23-59-59Z
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function sampleUniqueIndices(size, count) {
  const indices = Array.from({ length: size }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, Math.max(0, Math.min(count, indices.length)));
}

async function main() {
  await ensureDir(OUT_DIR);
  const stamp = isoStamp();
  const prefix = `studio-ui-regression-${stamp}`;
  const overviewPng = path.join(OUT_DIR, `${prefix}-overview.png`);
  const hierarchyPng = path.join(OUT_DIR, `${prefix}-hierarchy.png`);
  const stressPng = path.join(OUT_DIR, `${prefix}-stress.png`);
  const reportJson = path.join(OUT_DIR, `${prefix}.json`);
  const latestOverviewPng = path.join(OUT_DIR, "studio-ui-regression-latest-overview.png");
  const latestHierarchyPng = path.join(OUT_DIR, "studio-ui-regression-latest-hierarchy.png");
  const latestStressPng = path.join(OUT_DIR, "studio-ui-regression-latest-stress.png");
  const latestReportJson = path.join(OUT_DIR, "studio-ui-regression-latest.json");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 980 } });

  const report = {
    studioUrl: STUDIO_URL,
    startedAt: new Date().toISOString(),
    screenshots: {
      overview: path.relative(repoRoot, overviewPng),
      hierarchy: path.relative(repoRoot, hierarchyPng),
      stress: path.relative(repoRoot, stressPng),
    },
    metrics: {},
    failures: [],
  };

  try {
    await page.goto(STUDIO_URL, { waitUntil: "domcontentloaded" });
    await page.getByText("API:", { exact: false }).waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: "Build" }).click({ timeout: 30_000 });

    const moduleItems = page.locator("section.module-list button.module-item");
    await moduleItems.first().waitFor({ timeout: 90_000 });

    async function evaluateMetrics() {
      return page.evaluate(() => {
        function bboxOf(el) {
          if (!el) return null;
          if (typeof el.getBBox === "function") {
            const bb = el.getBBox();
            return { x: bb.x, y: bb.y, width: bb.width, height: bb.height };
          }
          return null;
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

        const bodies = Array.from(document.querySelectorAll("g.module-container-body-layer"));
        const headerRects = Array.from(document.querySelectorAll("g.module-container-header-layer rect.module-container-header-bg"));
        const nodeGroups = Array.from(document.querySelectorAll("svg.diagram g.node"));

        const bodyById = new Map();
        for (const g of bodies) {
          const id = g.getAttribute("data-id") || "";
          const rect = g.querySelector("rect.module-container-body");
          const bb = bboxOf(rect);
          if (id && bb) bodyById.set(id, bb);
        }
        const parentById = new Map();
        for (const g of bodies) {
          const id = g.getAttribute("data-id") || "";
          const parentId = g.getAttribute("data-parent-id") || "";
          if (id) parentById.set(id, parentId);
        }

        const containmentViolations = [];
        for (const [id, bodyBB] of bodyById.entries()) {
          const parentId = parentById.get(id) || "";
          if (!parentId) continue;
          const parentBB = bodyById.get(parentId);
          if (!parentBB) continue;
          if (!contains(parentBB, bodyBB, 0)) {
            containmentViolations.push({ id, parentId, parent: parentBB, child: bodyBB });
          }
        }

        const headersById = new Map();
        const headers = [];
        for (const rect of headerRects) {
          const group = rect.closest("g.module-container-header-layer");
          const id = group?.getAttribute("data-id") || "";
          const bb = bboxOf(rect);
          if (id && bb && !headersById.has(id)) {
            headersById.set(id, bb);
            headers.push({ id, bb });
          }
        }

        const headerContainmentViolations = [];
        const headerPlacementViolations = [];
        for (const [id, headerBB] of headersById.entries()) {
          const bodyBB = bodyById.get(id);
          if (!bodyBB) continue;
          if (!contains(bodyBB, headerBB, 0)) {
            headerContainmentViolations.push({ id, body: bodyBB, header: headerBB });
          }
          const dx = headerBB.x - bodyBB.x;
          const dy = headerBB.y - bodyBB.y;
          // Expect header tag anchored on the left/top edge of its container.
          if (dx > 40 || dx < -1 || dy > 28 || dy < -1) {
            headerPlacementViolations.push({ id, dx, dy, body: bodyBB, header: headerBB });
          }
        }

        const headerBoxes = headers.map((item) => item.bb);
        const headerOverlapPairs = [];
        for (let i = 0; i < headerBoxes.length; i += 1) {
          for (let j = i + 1; j < headerBoxes.length; j += 1) {
            const area = overlapArea(headerBoxes[i], headerBoxes[j]);
            if (area > 12) {
              headerOverlapPairs.push({ i, j, area, a: headers[i]?.id, b: headers[j]?.id });
            }
          }
        }

        const nodes = [];
        for (const group of nodeGroups) {
          const id = group.getAttribute("data-id") || "";
          const rect = group.querySelector("rect.node-body");
          const bb = bboxOf(rect);
          if (id && bb) nodes.push({ id, bb });
        }
        const nodeBoxes = nodes.map((item) => item.bb);
        const headerNodeOverlapPairs = [];
        for (let i = 0; i < headerBoxes.length; i += 1) {
          for (let j = 0; j < nodeBoxes.length; j += 1) {
            const area = overlapArea(headerBoxes[i], nodeBoxes[j]);
            if (area > 16) {
              headerNodeOverlapPairs.push({
                headerIndex: i,
                nodeIndex: j,
                area,
                headerId: headers[i]?.id,
                nodeId: nodes[j]?.id,
              });
            }
          }
        }

        const nodeIds = new Set(nodes.map((item) => item.id));
        const renderedLayerNodes = Array.from(nodeIds).filter((id) => id.startsWith("layer:"));

        const nonLayerContainerIds = Array.from(bodyById.keys()).filter((id) => !id.startsWith("layer:") && !id.startsWith("system:"));

        return {
          containerCount: bodyById.size,
          containmentViolations,
          headerCount: headerBoxes.length,
          headerContainmentViolations,
          headerPlacementViolations,
          headerOverlapPairs,
          headerNodeOverlapPairs,
          renderedLayerNodes,
          nonLayerContainerCount: nonLayerContainerIds.length,
        };
      });
    }

    // Normalize toggles (lane backgrounds off).
    if (await page.getByRole("button", { name: "Hide Lanes" }).count()) {
      await page.getByRole("button", { name: "Hide Lanes" }).click({ timeout: 10_000 });
    }

    // Root overview: multiple lanes + hierarchy frames.
    await page.locator("svg.diagram g.node").first().waitFor({ timeout: 60_000 });
    await page.screenshot({ path: overviewPng, fullPage: true });

    // Deep hierarchy: double-click the deepest module in the sidebar list to expand its path.
    await page.fill("#search", "");
    const deepestIndex = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("section.module-list button.module-item"));
      let bestIndex = 0;
      let bestLevel = -1;
      for (let i = 0; i < items.length; i += 1) {
        const levelRaw = items[i].getAttribute("data-level") || "";
        const level = Number.parseInt(levelRaw, 10);
        if (Number.isFinite(level) && level > bestLevel) {
          bestLevel = level;
          bestIndex = i;
        }
      }
      return bestIndex;
    });
    const deepTarget = moduleItems.nth(deepestIndex);
    report.deepTarget = {
      id: await deepTarget.getAttribute("data-id"),
      level: await deepTarget.getAttribute("data-level"),
      name: (await deepTarget.locator("strong").innerText()).trim(),
    };
    await deepTarget.dblclick({ timeout: 20_000 });
    await page.waitForFunction(() => {
      const bodies = Array.from(document.querySelectorAll("g.module-container-body-layer"));
      if (bodies.length <= 5) return false;
      return bodies.some((g) => {
        const id = g.getAttribute("data-id") || "";
        return id && !id.startsWith("layer:") && !id.startsWith("system:");
      });
    }, null, { timeout: 12_000 });
    await page.waitForTimeout(250);

    await page.screenshot({ path: hierarchyPng, fullPage: true });
    report.hierarchy_metrics = await evaluateMetrics();

    // Stress: random 50 modules across depths, 20 Add/Remove loops.
    await page.fill("#search", "");
    await moduleItems.first().waitFor({ timeout: 60_000 });

    const moduleCount = await moduleItems.count();
    const chosen = sampleUniqueIndices(moduleCount, 50);

    const addAround = page.getByRole("button", { name: "Add Around" });
    const removeAround = page.getByRole("button", { name: "Remove Around" });
    for (let i = 0; i < 20; i += 1) {
      const index = chosen[i % Math.max(1, chosen.length)] || 0;
      await moduleItems.nth(index).click({ timeout: 20_000 });
      await page.waitForTimeout(150);

      // Expand/collapse a random visible expandable node if available.
      const toggles = page.locator("svg.diagram g.node g.node-expand-toggle");
      const toggleCount = await toggles.count();
      if (toggleCount) {
        await toggles.nth(Math.floor(Math.random() * toggleCount)).click({ timeout: 10_000 });
        await page.waitForTimeout(120);
      }

      if (await addAround.isEnabled()) {
        await addAround.click();
        await page.waitForTimeout(120);
      }
      if (await removeAround.isEnabled()) {
        await removeAround.click();
        await page.waitForTimeout(120);
      }
    }

    // DOM/geometry checks (containment, chip overlaps, no layer:* nodes rendered).
    report.metrics = await evaluateMetrics();

    await page.screenshot({ path: stressPng, fullPage: true });
  } catch (error) {
    report.failures.push(String(error?.stack || error));
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await browser.close();
    await fs.writeFile(reportJson, JSON.stringify(report, null, 2) + "\n", "utf8");

    // Keep stable "latest" artifacts to make reviews easy (and avoid committing timestamp spam).
    await fs.copyFile(overviewPng, latestOverviewPng);
    await fs.copyFile(hierarchyPng, latestHierarchyPng);
    await fs.copyFile(stressPng, latestStressPng);
    const latestReport = {
      ...report,
      sourceReport: path.relative(repoRoot, reportJson),
      sourceScreenshots: { ...report.screenshots },
      screenshots: {
        overview: path.relative(repoRoot, latestOverviewPng),
        hierarchy: path.relative(repoRoot, latestHierarchyPng),
        stress: path.relative(repoRoot, latestStressPng),
      },
    };
    await fs.writeFile(latestReportJson, JSON.stringify(latestReport, null, 2) + "\n", "utf8");
  }

  process.stdout.write(`${path.relative(repoRoot, reportJson)}\n`);
}

await main();
