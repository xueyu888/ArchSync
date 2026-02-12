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
  const hierarchyPng = path.join(OUT_DIR, `${prefix}-hierarchy.png`);
  const stressPng = path.join(OUT_DIR, `${prefix}-stress.png`);
  const reportJson = path.join(OUT_DIR, `${prefix}.json`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 980 } });

  const report = {
    studioUrl: STUDIO_URL,
    startedAt: new Date().toISOString(),
    screenshots: {
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

    // Focus Engine to get a predictable deep hierarchy.
    await page.fill("#search", "Engine");
    await moduleItems.first().click();
    await page.locator("svg.diagram g.node").first().waitFor({ timeout: 60_000 });

    // Expand a few times to force nested container chain.
    for (let i = 0; i < 4; i += 1) {
      const toggle = page.locator("svg.diagram g.node g.node-expand-toggle").first();
      if (!(await toggle.count())) {
        break;
      }
      await toggle.click({ timeout: 10_000 });
      await page.waitForTimeout(250);
    }

    await page.screenshot({ path: hierarchyPng, fullPage: true });

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

    // DOM/geometry checks (headers-in-container, containment, header overlaps).
    report.metrics = await page.evaluate(() => {
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
      const headers = Array.from(document.querySelectorAll("g.module-container-header-layer"));

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
      const headerById = new Map();
      for (const g of headers) {
        const id = g.getAttribute("data-id") || "";
        const rect = g.querySelector("rect.module-container-header-bg");
        const bb = bboxOf(rect);
        if (id && bb) headerById.set(id, bb);
      }

      const headerInsideViolations = [];
      for (const [id, headerBB] of headerById.entries()) {
        const bodyBB = bodyById.get(id);
        if (!bodyBB) continue;
        if (!contains(bodyBB, headerBB, 0)) {
          headerInsideViolations.push({ id, body: bodyBB, header: headerBB });
        }
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

      const headerOverlapPairs = [];
      const headerIds = Array.from(headerById.keys());
      for (let i = 0; i < headerIds.length; i += 1) {
        for (let j = i + 1; j < headerIds.length; j += 1) {
          const aId = headerIds[i];
          const bId = headerIds[j];
          const a = headerById.get(aId);
          const b = headerById.get(bId);
          if (!a || !b) continue;
          const area = overlapArea(a, b);
          if (area > 8) {
            headerOverlapPairs.push({ a: aId, b: bId, area });
          }
        }
      }

      const headerXs = Array.from(headerById.values()).map((bb) => Math.round(bb.x));
      const distinctHeaderXs = Array.from(new Set(headerXs)).sort((a, b) => a - b);

      return {
        containerCount: bodyById.size,
        headerCount: headerById.size,
        distinctHeaderXs,
        headerInsideViolations,
        containmentViolations,
        headerOverlapPairs,
      };
    });

    await page.screenshot({ path: stressPng, fullPage: true });
  } catch (error) {
    report.failures.push(String(error?.stack || error));
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await browser.close();
    await fs.writeFile(reportJson, JSON.stringify(report, null, 2) + "\n", "utf8");
  }

  process.stdout.write(`${path.relative(repoRoot, reportJson)}\n`);
}

await main();

