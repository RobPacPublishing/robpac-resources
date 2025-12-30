/**
 * download_assets_playwright_v12.js (Windows/Git Bash friendly)
 * - Login once:    node download_assets_playwright.js --login
 * - One product:   node download_assets_playwright.js --one "0e927a25-9511-4995-8541-f532c3ef92d1"
 * - Batch:         node download_assets_playwright.js
 *
 * Notes:
 * - ALWAYS run via `node ...` (never `./download_assets_playwright.js`)
 * - Requires: npm i playwright, and `npx playwright install chromium`
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = __dirname;
const DEBUG_DIR = path.join(ROOT, "debug");
const DOWNLOADS_DIR = path.join(ROOT, "downloads");
const STORAGE_STATE = path.join(ROOT, ".storage_state.json");
const MANIFEST_PATH = path.join(ROOT, "downloads_manifest.json");

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function extractUuid(s) {
  const m = String(s || "").match(UUID_RE);
  return m ? m[0].toLowerCase() : null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function parseArgs(argv) {
  const args = {
    login: false,
    one: null,
    headless: false,
    slowMo: 0,
    limit: 0,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--login") args.login = true;
    else if (a === "--headless") args.headless = true;
    else if (a === "--slowmo") args.slowMo = Number(argv[i + 1] || "0") || 0, i++;
    else if (a === "--limit") args.limit = Number(argv[i + 1] || "0") || 0, i++;
    else if (a === "--one") args.one = argv[i + 1] || null, i++;
  }
  return args;
}

function loadProductIds(args) {
  // Prefer entrepedia_products.json (scraper output), fallback to products.json
  const candidates = [
    path.join(ROOT, "entrepedia_products.json"),
    path.join(ROOT, "..", "entrepedia_products.json"),
    path.join(ROOT, "..", "products.json"),
    path.join(ROOT, "products.json"),
  ];

  if (args.one) {
    const id = extractUuid(args.one);
    if (!id) throw new Error("Invalid --one value. Provide UUID or full product URL.");
    return [id];
  }

  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const data = readJsonSafe(p);
    if (!data) continue;

    // allow array of products or {products:[...]}
    const arr = Array.isArray(data) ? data : Array.isArray(data.products) ? data.products : null;
    if (!arr) continue;

    const ids = [];
    for (const item of arr) {
      const id = extractUuid(item && (item.id || item.productId || item.url || item.productUrl || item.uuid));
      if (id) ids.push(id);
    }
    if (ids.length) {
      // unique, stable order
      return Array.from(new Set(ids));
    }
  }

  throw new Error("No product list found. Expected entrepedia_products.json or products.json.");
}

async function waitForManualEnter(promptText) {
  process.stdout.write(promptText);
  return new Promise((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", () => resolve());
  });
}

async function safeClickDownload(context, page, id) {
  // Strategy:
  // 1) Look for obvious text buttons: "Download product", "Download"
  // 2) Look for elements with aria-label/title containing "download"
  // 3) Look for a download icon button in the page by scanning clickable elements in DOM
  // Then: click and wait for download event, including popups.

  const candidates = [];

  // 1) Text buttons
  candidates.push(async () => {
    const loc = page.getByRole("button", { name: /download product|download/i }).first();
    if (await loc.count()) return { type: "locator", locator: loc, label: "role-button-download" };
    return null;
  });

  // 2) aria-label/title
  candidates.push(async () => {
    const loc = page.locator('[aria-label*="download" i], [title*="download" i], [data-testid*="download" i]').first();
    if (await loc.count()) return { type: "locator", locator: loc, label: "aria/title/testid-download" };
    return null;
  });

  // 3) DOM scan (icon button). We pick the first clickable whose HTML mentions "download" OR has an SVG path typical of download icon.
  candidates.push(async () => {
    const handle = await page.evaluateHandle(() => {
      const isVisible = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 4 && r.height > 4 && r.bottom > 0 && r.right > 0;
      };
      const clickables = Array.from(document.querySelectorAll("button,a,[role='button']"));
      const looksLikeDownloadSvg = (el) => {
        const svg = el.querySelector && el.querySelector("svg");
        if (!svg) return false;
        const html = svg.innerHTML || "";
        // Lucide/feather download usually includes these fragments in path data
        return /M21\s*15v4/i.test(html) || /M12\s*3v12/i.test(html) || /download/i.test(html);
      };
      for (const el of clickables) {
        const txt = (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "").toLowerCase();
        if (!isVisible(el)) continue;
        if (txt.includes("download")) return el;
        if (looksLikeDownloadSvg(el)) return el;
      }
      return null;
    });
    const el = handle.asElement();
    if (el) return { type: "handle", handle: el, label: "dom-scan-download" };
    await handle.dispose();
    return null;
  });

  // Wait for possible popup + download
  const tryClick = async (clickFn) => {
    const popupPromise = context.waitForEvent("page").catch(() => null);
    const dlPromise = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);

    await clickFn();

    // direct download on same page
    const dl1 = await dlPromise;
    if (dl1) return { download: dl1, via: "page-download" };

    // maybe opened new page first
    const pop = await popupPromise;
    if (pop) {
      try { await pop.waitForLoadState("domcontentloaded", { timeout: 15000 }); } catch {}
      const dl2 = await pop.waitForEvent("download", { timeout: 15000 }).catch(() => null);
      if (dl2) return { download: dl2, via: "popup-download" };
    }

    // maybe navigation triggers download without download event; give a little time
    await sleep(1500);
    return null;
  };

  // Execute candidates in order
  for (const getCand of candidates) {
    const c = await getCand().catch(() => null);
    if (!c) continue;

    const res = await tryClick(async () => {
      if (c.type === "locator") {
        await c.locator.scrollIntoViewIfNeeded().catch(() => {});
        await c.locator.click({ timeout: 15000 }).catch(async () => {
          // fallback: force click if overlays
          await c.locator.click({ timeout: 15000, force: true }).catch(() => {});
        });
      } else if (c.type === "handle") {
        await c.handle.scrollIntoViewIfNeeded?.().catch(() => {});
        await c.handle.click?.().catch(() => {});
      }
    });

    if (res && res.download) return { ...res, label: c.label };
  }

  return null;
}

async function saveDownload(download, id) {
  ensureDir(DOWNLOADS_DIR);
  const prodDir = path.join(DOWNLOADS_DIR, id);
  ensureDir(prodDir);

  const suggested = download.suggestedFilename() || `${id}.bin`;
  const targetPath = path.join(prodDir, suggested);

  await download.saveAs(targetPath);

  return { file: path.relative(ROOT, targetPath).replace(/\\/g, "/"), suggested };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  ensureDir(DEBUG_DIR);
  ensureDir(DOWNLOADS_DIR);

  const ids = loadProductIds(args);
  const list = args.limit > 0 ? ids.slice(0, args.limit) : ids;

  const browser = await chromium.launch({ headless: args.headless, slowMo: args.slowMo || 0 });

  let context;
  if (fs.existsSync(STORAGE_STATE)) {
    context = await browser.newContext({
      acceptDownloads: true,
      storageState: STORAGE_STATE,
    });
  } else {
    context = await browser.newContext({ acceptDownloads: true });
  }

  const page = await context.newPage();

  if (args.login) {
    await page.goto("https://app.entrepedia.co/library", { waitUntil: "domcontentloaded" });
    console.log("LOGIN: fai login nella finestra aperta (eventuale 2FA).");
    await waitForManualEnter("Quando sei loggato e vedi la Library, premi INVIO qui nel terminale...\n");
    const state = await context.storageState();
    fs.writeFileSync(STORAGE_STATE, JSON.stringify(state, null, 2));
    console.log("LOGIN OK. Salvato stato in .storage_state.json");
    await browser.close();
    process.exit(0);
  }

  const manifest = readJsonSafe(MANIFEST_PATH) || {};
  manifest._meta = manifest._meta || { updatedAt: new Date().toISOString() };

  let ok = 0, skipped = 0, failed = 0;

  for (let i = 0; i < list.length; i++) {
    const id = list[i];
    const label = `[${i + 1}/${list.length}]`;

    try {
      // Skip if already downloaded
      if (manifest[id] && Array.isArray(manifest[id]) && manifest[id].length) {
        console.log(`${label} SKIP ${id} (already in manifest)`);
        skipped++;
        continue;
      }

      const url = `https://app.entrepedia.co/library/product/${id}`;
      console.log(`${label} OPEN ${id}`);
      await page.goto(url, { waitUntil: "domcontentloaded" });

      // Let the UI hydrate
      await page.waitForTimeout(1200);

      const res = await safeClickDownload(context, page, id);
      if (!res || !res.download) {
        console.log(`${label} FAIL ${id} NO_DOWNLOAD_TRIGGER_FOUND`);
        manifest[id] = [];
        failed++;
        writeJson(MANIFEST_PATH, manifest);
        continue;
      }

      const saved = await saveDownload(res.download, id);
      console.log(`${label} OK ${id} saved ${saved.file} via ${res.via}/${res.label}`);

      manifest[id] = manifest[id] || [];
      manifest[id].push(saved.file);
      ok++;
      manifest._meta.updatedAt = new Date().toISOString();
      writeJson(MANIFEST_PATH, manifest);

      // Small pause to avoid throttling
      await sleep(800);
    } catch (e) {
      console.log(`${label} FAIL ${id} ${String(e && e.message ? e.message : e)}`);
      manifest[id] = manifest[id] || [];
      failed++;
      manifest._meta.updatedAt = new Date().toISOString();
      writeJson(MANIFEST_PATH, manifest);
      // Attempt to continue
      try { await page.waitForTimeout(500); } catch {}
    }
  }

  await browser.close();

  console.log("DONE", { ok, skipped, failed, manifest: path.basename(MANIFEST_PATH) });
}

main().catch((e) => {
  console.error("FATAL", e && e.message ? e.message : e);
  process.exit(1);
});
