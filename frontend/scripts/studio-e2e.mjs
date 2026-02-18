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

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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
        function parsePathPoints(d) {
          const nums = String(d || "").match(/-?\\d+(?:\\.\\d+)?/g);
          if (!nums || nums.length < 4) return [];
          const out = [];
          for (let i = 0; i + 1 < nums.length; i += 2) {
            out.push({ x: Number(nums[i]), y: Number(nums[i + 1]) });
          }
          return out;
        }
        function pointInRect(point, rect, pad = 0.6) {
          if (!point || !rect) return false;
          return (
            point.x >= rect.x - pad
            && point.x <= rect.x + rect.width + pad
            && point.y >= rect.y - pad
            && point.y <= rect.y + rect.height + pad
          );
        }
        function segmentHitsRect(a, b, rect, pad = 1.6) {
          const r = {
            x: rect.x - pad,
            y: rect.y - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
          };
          const dx = Math.abs(a.x - b.x);
          const dy = Math.abs(a.y - b.y);
          if (dx < 0.2 && dy < 0.2) return false;
          if (dy < 0.2) {
            const y = a.y;
            const minX = Math.min(a.x, b.x);
            const maxX = Math.max(a.x, b.x);
            if (!(y > r.y && y < r.y + r.height)) return false;
            return maxX > r.x && minX < r.x + r.width;
          }
          if (dx < 0.2) {
            const x = a.x;
            const minY = Math.min(a.y, b.y);
            const maxY = Math.max(a.y, b.y);
            if (!(x > r.x && x < r.x + r.width)) return false;
            return maxY > r.y && minY < r.y + r.height;
          }
          return false;
        }

        const bodies = Array.from(document.querySelectorAll("g.module-container-body-layer"));
        const headerRects = Array.from(document.querySelectorAll("g.hierarchy-chip rect.hierarchy-chip-bg"));
        const nodeGroups = Array.from(document.querySelectorAll("svg.diagram g.node"));
        const dimmedNodes = document.querySelectorAll("svg.diagram g.node.dimmed").length;
        const dimmedEdges = document.querySelectorAll("svg.diagram g.edge.dimmed").length;

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
          const group = rect.closest("g.hierarchy-chip");
          const id = group?.getAttribute("data-id") || "";
          const bb = bboxOf(rect);
          if (id && bb && !headersById.has(id)) {
            headersById.set(id, bb);
            headers.push({ id, bb });
          }
        }

        const headerContainmentViolations = [];
        const headerPlacementViolations = [];

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
        const nodeBBById = new Map(nodes.map((item) => [item.id, item.bb]));
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

        // Edge visibility invariant: edges should not run under node bodies.
        const edgePaths = Array.from(document.querySelectorAll("g.edge-group path.edge:not(.edge-interface-shell)"));
        let edgeNodeIntersectionCount = 0;
        const edgeNodeIntersections = [];
        for (const path of edgePaths) {
          const d = path.getAttribute("d") || "";
          const points = parsePathPoints(d);
          if (points.length < 2) continue;
          const start = points[0];
          const end = points[points.length - 1];
          let srcId = "";
          let dstId = "";
          for (const node of nodes) {
            if (!srcId && pointInRect(start, node.bb, 1.2)) srcId = node.id;
            if (!dstId && pointInRect(end, node.bb, 1.2)) dstId = node.id;
            if (srcId && dstId) break;
          }
          for (let i = 0; i < points.length - 1; i += 1) {
            const a = points[i];
            const b = points[i + 1];
            for (const node of nodes) {
              if (!node || node.id === srcId || node.id === dstId) continue;
              if (segmentHitsRect(a, b, node.bb, 1.8)) {
                edgeNodeIntersectionCount += 1;
                if (edgeNodeIntersections.length < 30) {
                  edgeNodeIntersections.push({ nodeId: node.id, a, b });
                }
                break;
              }
            }
          }
        }

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
          dimmedNodes,
          dimmedEdges,
          edgeNodeIntersectionCount,
          edgeNodeIntersections,
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

    // Resize smoke test: node frames should be resizable (all-is-frames) without reintroducing
    // edge-under-node regressions.
    const resizeTargetId = await page.evaluate(() => {
      const node = document.querySelector("svg.diagram g.node");
      return node?.getAttribute("data-id") || "";
    });
    if (resizeTargetId) {
      await page.locator(`svg.diagram g.node[data-id="${resizeTargetId}"]`).first().click({ timeout: 10_000 });
      await page.waitForTimeout(150);
      const before = await page.evaluate((id) => {
        const rect = document.querySelector(`svg.diagram g.node[data-id="${id}"] rect.node-body`);
        if (!rect || typeof rect.getBBox !== "function") return null;
        const bb = rect.getBBox();
        return { width: bb.width, height: bb.height };
      }, resizeTargetId);

      const handle = page.locator(`svg.diagram g.node[data-id="${resizeTargetId}"] g.node-resize-handle[data-edge="br"] rect.frame-resize-hit`).first();
      if (await handle.count()) {
        await handle.scrollIntoViewIfNeeded();
        const bb = await handle.boundingBox();
        if (bb) {
          await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
          await page.mouse.down();
          await page.mouse.move(bb.x + bb.width / 2 + 120, bb.y + bb.height / 2 + 84, { steps: 10 });
          await page.mouse.up();
          await page.waitForTimeout(220);
        }
      } else {
        report.failures.push(`missing resize handle for node: ${resizeTargetId}`);
      }

      const after = await page.evaluate((id) => {
        const rect = document.querySelector(`svg.diagram g.node[data-id="${id}"] rect.node-body`);
        if (!rect || typeof rect.getBBox !== "function") return null;
        const bb = rect.getBBox();
        return { width: bb.width, height: bb.height };
      }, resizeTargetId);
      report.resize_smoke = { id: resizeTargetId, before, after };
      report.resize_smoke_metrics = await evaluateMetrics();

      const resizeContainerId = await page.evaluate(() => {
        const bodies = Array.from(document.querySelectorAll("svg.diagram g.module-container-body-layer"));
        for (const g of bodies) {
          const id = g.getAttribute("data-id") || "";
          if (!id || id.startsWith("layer:")) continue;
          return id;
        }
        return "";
      });
      if (resizeContainerId) {
        const cBefore = await page.evaluate((id) => {
          const rect = document.querySelector(`svg.diagram g.module-container-body-layer[data-id="${id}"] rect.module-container-body`);
          if (!rect || typeof rect.getBBox !== "function") return null;
          const bb = rect.getBBox();
          return { width: bb.width, height: bb.height };
        }, resizeContainerId);

        const cHandle = page.locator(`svg.diagram g.container-resize-handle[data-id="${resizeContainerId}"][data-edge="br"] rect.frame-resize-hit`).first();
        if (await cHandle.count()) {
          await cHandle.scrollIntoViewIfNeeded();
          const bb = await cHandle.boundingBox();
          if (bb) {
            await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
            await page.mouse.down();
            await page.mouse.move(bb.x + bb.width / 2 + 140, bb.y + bb.height / 2 + 100, { steps: 10 });
            await page.mouse.up();
            await page.waitForTimeout(220);
          }
        } else {
          report.failures.push(`missing resize handle for container: ${resizeContainerId}`);
        }

        const cAfter = await page.evaluate((id) => {
          const rect = document.querySelector(`svg.diagram g.module-container-body-layer[data-id="${id}"] rect.module-container-body`);
          if (!rect || typeof rect.getBBox !== "function") return null;
          const bb = rect.getBBox();
          return { width: bb.width, height: bb.height };
        }, resizeContainerId);

        report.container_resize_smoke = { id: resizeContainerId, before: cBefore, after: cAfter };
        report.container_resize_smoke_metrics = await evaluateMetrics();
      }

      // Reset manual overrides so later screenshots remain comparable.
      const autoLayoutBtn = page.getByRole("button", { name: "Auto Layout" });
      if (await autoLayoutBtn.count()) {
        await autoLayoutBtn.click({ timeout: 10_000 });
        await page.waitForTimeout(200);
      }
    }

    // Deep hierarchy: double-click the deepest module in the sidebar list to select it,
    // then expand one visible node and verify container header toggles collapse it.
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

    const expandTargetId = await page.evaluate(() => {
      const toggle = document.querySelector("svg.diagram g.node.expandable g.node-expand-toggle");
      const node = toggle?.closest("g.node");
      return node?.getAttribute("data-id") || "";
    });
    if (expandTargetId) {
      const toggle = page.locator(`svg.diagram g.node[data-id="${expandTargetId}"] g.node-expand-toggle`).first();
      if (await toggle.count()) {
        await toggle.click({ timeout: 10_000 });
        await page.waitForFunction((id) => !document.querySelector(`svg.diagram g.node[data-id="${id}"]`), expandTargetId, { timeout: 12_000 });
        await page.waitForTimeout(200);
      }
    }

    await page.screenshot({ path: hierarchyPng, fullPage: true });
    report.hierarchy_metrics = await evaluateMetrics();

    if (expandTargetId) {
      const headerToggle = page.locator(`svg.diagram g.hierarchy-chip[data-id="${expandTargetId}"] g.hierarchy-chip-toggle`).first();
      if (await headerToggle.count()) {
        await headerToggle.click({ timeout: 10_000 });
        await page.waitForFunction((id) => !!document.querySelector(`svg.diagram g.node[data-id="${id}"]`), expandTargetId, { timeout: 12_000 });
        await page.waitForTimeout(200);
      } else {
        throw new Error(`missing header toggle for expanded node: ${expandTargetId}`);
      }
    }

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
    const canUpdateLatest = await Promise.all([
      fileExists(overviewPng),
      fileExists(hierarchyPng),
      fileExists(stressPng),
    ]).then((items) => items.every(Boolean));
    if (canUpdateLatest) {
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
  }

  process.stdout.write(`${path.relative(repoRoot, reportJson)}\n`);
}

await main();
