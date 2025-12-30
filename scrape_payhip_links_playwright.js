#!/usr/bin/env node
/**
 * scrape_payhip_links_playwright.js  (V5)
 *
 * Estrae TUTTI i link /b/<slug> dalla pagina Payhip "Products" scorrendo pagine.
 * Output: payhip_links.json in formato JSONL (1 riga = {"title","url"}).
 *
 * Uso (da ROOT repo: F:\robpac-resources):
 *   node scrape_payhip_links_playwright.js --channel chrome
 *
 * Opzioni:
 *   --out <file>        default ./payhip_links.json
 *   --user-data <dir>   default ./.pw-payhip-session
 *   --channel <name>    default chrome
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { chromium } = require("playwright");

function argValue(argv, key, defVal=null){
  const i = argv.indexOf(key);
  return (i>=0 && i+1<argv.length) ? argv[i+1] : defVal;
}
function fileExists(p){ try{ fs.accessSync(p); return true; } catch { return false; } }
function ensureDir(p){ if(!fileExists(p)) fs.mkdirSync(p, { recursive:true }); }

function waitEnter(msg){
  return new Promise((resolve)=>{
    console.log(msg);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("", ()=>{ rl.close(); resolve(); });
  });
}

function normTitle(s){
  return String(s||"")
    .replace(/\s+/g, " ")
    .replace(/[’]/g, "'")
    .trim();
}

async function maybeLogin(page){
  const url = page.url();
  if(url.includes("/login") || url.includes("/sign-in")){
    await waitEnter('LOGIN: si apre Payhip. Esegua login nel browser, poi torni qui e prema INVIO.');
    return;
  }
  const hasEmail = await page.locator('input[type="email"], input[name*="email" i]').first().isVisible().catch(()=>false);
  const hasPass  = await page.locator('input[type="password"]').first().isVisible().catch(()=>false);
  if(hasEmail && hasPass){
    await waitEnter('LOGIN: si apre Payhip. Esegua login nel browser, poi torni qui e prema INVIO.');
  }
}

async function gotoProducts(page){
  await page.goto("https://payhip.com/products", { waitUntil: "domcontentloaded" });
  await maybeLogin(page);
  if(!page.url().includes("/products")){
    await page.goto("https://payhip.com/products", { waitUntil: "domcontentloaded" });
  }
  await page.waitForTimeout(800);
}

async function getRows(page){
  const tRows = page.locator("table tbody tr");
  const n = await tRows.count().catch(()=>0);
  if(n>0) return { locator: tRows, count: n };

  const listRows = page.locator('[data-testid="products-list"] [data-testid="product-row"], .products-list .product-row, .products table tbody tr');
  const m = await listRows.count().catch(()=>0);
  return { locator: listRows, count: m };
}

async function extractFromRow(row){
  let title = "";
  const titleLocators = [
    row.locator('a').first(),
    row.locator('td').first().locator('a').first(),
    row.locator('td').nth(1).locator('a').first(),
  ];
  for(const loc of titleLocators){
    title = await loc.innerText().catch(()=> "");
    title = normTitle(title);
    if(title) break;
  }

  let url = "";
  const viewLink = row.locator('a:has-text("View")').first();
  const href = await viewLink.getAttribute("href").catch(()=>null);
  if(href){
    url = href.startsWith("http") ? href : ("https://payhip.com" + href);
    if(!url.includes("/b/")) url = "";
  }
  return { title, url };
}

async function extractViaShareModal(page, row){
  const btn = row.locator('a:has-text("Share / Embed"), button:has-text("Share / Embed")').first();
  await btn.click({ timeout: 8000 }).catch(()=>{});
  const input = page.locator('input[value*="/b/"], input[type="text"][value*="/b/"]').first();
  await input.waitFor({ timeout: 8000 }).catch(()=>{});
  const val = await input.inputValue().catch(()=> "");
  await page.keyboard.press("Escape").catch(()=>{});
  await page.waitForTimeout(250);
  return val && val.includes("/b/") ? val.trim() : "";
}

async function nextPage(page){
  const nextCandidates = [
    page.locator('a[rel="next"]').first(),
    page.locator('a:has-text(">")').first(),
    page.locator('button:has-text(">")').first(),
    page.locator('a:has-text("Next")').first(),
    page.locator('button:has-text("Next")').first(),
  ];
  for(const c of nextCandidates){
    const vis = await c.isVisible().catch(()=>false);
    if(!vis) continue;
    const aria = await c.getAttribute("aria-disabled").catch(()=>null);
    const cls = await c.getAttribute("class").catch(()=> "");
    if(aria === "true" || (cls && /disabled/i.test(cls))) return false;
    await c.click().catch(()=>null);
    await page.waitForTimeout(900);
    return true;
  }
  return false;
}

async function main(){
  const argv = process.argv.slice(2);
  const outPath = argValue(argv, "--out", "./payhip_links.json");
  const userDataDir = argValue(argv, "--user-data", "./.pw-payhip-session");
  const channel = argValue(argv, "--channel", "chrome");

  ensureDir(userDataDir);

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel,
    headless: false,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  await gotoProducts(page);

  const seen = new Map(); // title -> url
  let guard = 0;

  while(true){
    guard++;
    if(guard > 80) break;

    const { locator, count } = await getRows(page);
    if(count === 0) await page.waitForTimeout(1000);

    for(let i=0;i<count;i++){
      const row = locator.nth(i);
      let { title, url } = await extractFromRow(row);
      if(!title) continue;
      if(!url) url = await extractViaShareModal(page, row);
      if(url && url.includes("/b/") && !seen.has(title)) seen.set(title, url);
    }

    const moved = await nextPage(page);
    if(!moved) break;
  }

  const lines = [];
  for(const [title, url] of seen.entries()){
    lines.push(JSON.stringify({ title, url }));
  }
  fs.writeFileSync(outPath, lines.join("\n") + (lines.length? "\n":""), "utf8");

  console.log(`OK. Salvato: ${path.resolve(outPath)} ( ${lines.length} righe )`);
  await context.close();
}

main().catch((err)=>{
  console.error("FATAL:", err?.message || err);
  process.exit(1);
});
