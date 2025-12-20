/**
 * Entrepedia Library Downloader — v8
 * - CLICCA l'icona download sulla CARD in /library (NON la pagina prodotto)
 *
 * Run:
 *   npx playwright install chromium
 *   node download_assets_playwright.js --one "<uuid-or-url>"
 *   node download_assets_playwright.js
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, "downloads");
const DEBUG_DIR = path.join(ROOT, "debug");
const USER_DATA_DIR = path.join(ROOT, ".pw-user-data");
const MANIFEST_PATH = path.join(ROOT, "downloads_manifest.json");

// input list (urls.txt)
const URLS_PATH = path.join(ROOT, "urls.txt");

// mapping: id -> title (NECESSARIO)
const TITLE_MAP_CANDIDATES = [
  path.join(ROOT, "entrepedia_id_title.json"),
  path.join(ROOT, "..", "entrepedia_id_title.json"),
];

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p, { recursive:true }); }
function safeName(s){
  return String(s||"download.bin")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g," ")
    .trim()
    .slice(0,180) || "download.bin";
}
function extractUuid(s){
  const m = String(s||"").match(UUID_RE);
  return m ? m[0].toLowerCase() : null;
}
function normalizeProductUrl(u){
  const id = extractUuid(u);
  return id ? `https://app.entrepedia.co/library/product/${id}` : null;
}
function loadJsonIfExists(p){
  try{
    if(!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p,"utf8"));
  }catch{ return null; }
}
function loadTitleMap(){
  for(const p of TITLE_MAP_CANDIDATES){
    const j = loadJsonIfExists(p);
    if(j && typeof j === "object") return j;
  }
  return {};
}
function readUrlsTxt(){
  if(!fs.existsSync(URLS_PATH)) throw new Error("urls.txt non trovato: " + URLS_PATH);
  const lines = fs.readFileSync(URLS_PATH, "utf8").split(/\r?\n/);
  const ids = [];
  const seen = new Set();
  for(const raw of lines){
    const t = raw.trim();
    if(!t || t.startsWith("#")) continue;
    const url = normalizeProductUrl(t);
    if(!url) continue;
    const id = extractUuid(url);
    if(id && !seen.has(id)){
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}
function loadManifest(){
  if(!fs.existsSync(MANIFEST_PATH)) return {};
  try{
    const j = JSON.parse(fs.readFileSync(MANIFEST_PATH,"utf8"));
    return (j && typeof j === "object") ? j : {};
  }catch{ return {}; }
}
function saveManifest(m){ fs.writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2)); }

function parseArgs(argv){
  const args = { one:null, headless:false };
  for(let i=0;i<argv.length;i++){
    const a = argv[i];
    if(a === "--one"){ args.one = argv[i+1] || null; i++; }
    else if(a === "--headless"){ args.headless = true; }
  }
  return args;
}

async function gotoLibrary(page){
  await page.goto("https://app.entrepedia.co/library", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1200);
}

async function waitForLibraryReady(page, timeoutMs=15*60*1000){
  const start = Date.now();
  while(Date.now() - start < timeoutMs){
    const searchCount = await page.getByPlaceholder(/search for products/i).count().catch(()=>0);
    if(searchCount > 0) return true;
    await page.waitForTimeout(1200);
  }
  return false;
}

async function clearSearch(page){
  const search = page.getByPlaceholder(/search for products/i).first();
  await search.click({ timeout: 15000 }).catch(()=>{});
  await search.fill("").catch(()=>{});
  await page.waitForTimeout(600);
}

async function searchByTitle(page, title){
  const search = page.getByPlaceholder(/search for products/i).first();
  await search.click({ timeout: 15000 });
  await search.fill("");
  await search.type(title, { delay: 10 });
  await page.waitForTimeout(1200);
}

async function findCardByTitle(page, title){
  const titleLoc = page.locator(`text=${title}`).first();
  await titleLoc.waitFor({ timeout: 20000 });

  // card: contenitore che include anche il bottone Open
  const card = titleLoc.locator('xpath=ancestor::*[self::div or self::article][.//button[normalize-space()="Open"]][1]');
  if(await card.count().catch(()=>0)) return card.first();

  return titleLoc.locator('xpath=ancestor::*[self::div or self::article][1]').first();
}

async function clickDownloadIconOnCard(card){
  const openBtn = card.locator('button', { hasText: 'Open' }).first();
  await openBtn.waitFor({ timeout: 15000 });

  const row = openBtn.locator('xpath=..');
  const btns = row.locator('button');
  const count = await btns.count().catch(()=>0);

  if(count >= 2){
    const dlBtn = btns.nth(count - 1);
    await dlBtn.click({ timeout: 20000 }).catch(async()=>dlBtn.click({ timeout: 20000, force:true }));
    return true;
  }

  const svgBtn = card.locator('button:has(svg)').last();
  if(await svgBtn.count().catch(()=>0)){
    await svgBtn.click({ timeout: 20000 }).catch(async()=>svgBtn.click({ timeout: 20000, force:true }));
    return true;
  }
  return false;
}

async function main(){
  const args = parseArgs(process.argv.slice(2));

  ensureDir(OUT_DIR);
  ensureDir(DEBUG_DIR);

  const titleMap = loadTitleMap();
  const manifest = loadManifest();

  let ids = readUrlsTxt();
  if(args.one){
    const id = extractUuid(args.one);
    if(!id) { console.error("INVALID_ONE"); process.exit(1); }
    ids = [id];
  }

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: !!args.headless,
    acceptDownloads: true,
    viewport: { width: 1280, height: 900 },
  });

  const page = context.pages()[0] || await context.newPage();
  await gotoLibrary(page);

  const ready = await waitForLibraryReady(page);
  if(!ready){
    console.log("LIBRARY_NOT_READY");
    await context.close();
    process.exit(1);
  }

  console.log("V8_READY", "Products:", ids.length);

  let ok=0, skipped=0, failed=0;

  for(let i=0;i<ids.length;i++){
    const id = ids[i];

    if(Array.isArray(manifest[id]) && manifest[id].length){
      console.log(`[${i+1}/${ids.length}] SKIP`, id);
      skipped++;
      continue;
    }

    const title = titleMap[id] || titleMap[id.toUpperCase()] || titleMap[id.toLowerCase()] || null;
    console.log(`[${i+1}/${ids.length}]`, "ID", id, title ? "TITLE_OK" : "NO_TITLE");

    await gotoLibrary(page);

    if(!title){
      fs.writeFileSync(path.join(DEBUG_DIR, `${id}.error.json`), JSON.stringify({ id, error: "NO_TITLE_IN_entrepedia_id_title.json" }, null, 2));
      manifest[id] = [];
      saveManifest(manifest);
      console.log("FAIL", id, "NO_TITLE");
      failed++;
      continue;
    }

    await clearSearch(page);
    await searchByTitle(page, title);

    const card = await findCardByTitle(page, title);

    const productDir = path.join(OUT_DIR, id);
    ensureDir(productDir);

    const dlPromise = page.waitForEvent("download", { timeout: 45000 }).catch(()=>null);

    const clicked = await clickDownloadIconOnCard(card);
    if(!clicked){
      await page.screenshot({ path: path.join(DEBUG_DIR, `${id}.no_download_icon.png`), fullPage: true }).catch(()=>{});
      manifest[id] = [];
      saveManifest(manifest);
      console.log("FAIL", id, "NO_DOWNLOAD_ICON");
      failed++;
      continue;
    }

    const dl = await dlPromise;
    if(!dl){
      await page.screenshot({ path: path.join(DEBUG_DIR, `${id}.no_download_event.png`), fullPage: true }).catch(()=>{});
      manifest[id] = [];
      saveManifest(manifest);
      console.log("FAIL", id, "NO_DOWNLOAD_EVENT");
      failed++;
      continue;
    }

    const suggested = dl.suggestedFilename() || `${id}.bin`;
    const outPath = path.join(productDir, safeName(suggested));
    await dl.saveAs(outPath);

    const rel = path.relative(ROOT, outPath).split(path.sep).join("/");
    manifest[id] = [rel];
    saveManifest(manifest);

    console.log("OK", id, rel);
    ok++;
  }

  await context.close();
  console.log("V8_DONE", { ok, skipped, failed, manifest: path.basename(MANIFEST_PATH) });
}

main().catch(e=>{
  console.error("FATAL", e && e.message ? e.message : e);
  process.exit(1);
});
