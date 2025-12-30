#!/usr/bin/env node
/**
 * fetch_missing_payhip_links.js
 * Recupera automaticamente i link Payhip (/b/XXXXX) per i prodotti mancanti, usando la ricerca nella pagina Products.
 *
 * Input richiesti (nella stessa cartella):
 *   - products.json
 *   - payhip_links.json
 *
 * Output:
 *   - payhip_missing_links.json
 *   - payhip_links_merged.json
 *
 * Uso:
 *   node fetch_missing_payhip_links.js --channel chrome
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { chromium } = require("playwright");

function argValue(argv, key, defVal=null){
  const i = argv.indexOf(key);
  if(i === -1) return defVal;
  return argv[i+1] ?? defVal;
}
function hasFlag(argv, key){ return argv.includes(key); }
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

async function waitEnter(prompt){
  process.stdout.write(prompt);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question("", () => { rl.close(); resolve(); }));
}

function normTitle(s){
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function loadJson(p){
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function extractPayhipId(url){
  const m = String(url||"").match(/\/b\/([A-Za-z0-9]+)/);
  return m ? m[1] : "";
}

async function ensureProductsPage(page){
  await page.goto("https://payhip.com/dashboard", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
  // click Products (menu)
  try{
    await page.getByRole("link", { name: /^products$/i }).first().click({ timeout: 8000 });
  }catch{}
  await sleep(1200);

  // fallback URL
  if(!/payhip\.com\/.*products/i.test(page.url())){
    await page.goto("https://payhip.com/products", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
    await sleep(1200);
  }

  // Seleziona "All" per sicurezza (se presente)
  try{ await page.getByRole("link", { name: /^all/i }).first().click({ timeout: 6000 }); }catch{}
  await sleep(800);
}

async function clearAndType(page, locator, value){
  await locator.click({ timeout: 8000 }).catch(()=>{});
  // ctrl+a, delete
  await locator.press("Control+A").catch(()=>{});
  await locator.press("Backspace").catch(()=>{});
  await locator.type(value, { delay: 10 }).catch(()=>{});
}

async function extractBLinkFromModal(page){
  // Cerca input con URL payhip.com/b/XXXXX
  try{
    const vals = await page.locator("input").evaluateAll(els =>
      els.map(e => (e && e.value) ? String(e.value) : "").filter(Boolean)
    );
    const hit = vals.find(v => /^https:\/\/payhip\.com\/b\/[A-Za-z0-9]+/.test(v.trim()));
    if(hit) return hit.trim();
  }catch{}
  // fallback testo
  try{
    const t = await page.locator("body").innerText();
    const m = t.match(/https:\/\/payhip\.com\/b\/[A-Za-z0-9]+/);
    if(m) return m[0];
  }catch{}
  return "";
}

async function closeModalIfAny(page){
  // ESC chiude molte modali
  await page.keyboard.press("Escape").catch(()=>{});
  await sleep(350);
}

async function fetchOne(page, title){
  // Usa la search box in Products
  const search = page.locator('input[placeholder*="Search for product" i], input[name*="search" i]').first();
  await search.waitFor({ state: "visible", timeout: 20000 });

  await clearAndType(page, search, title);

  // click Search button
  try{
    await page.getByRole("button", { name: /^search$/i }).first().click({ timeout: 8000 });
  }catch{
    // invio come fallback
    await search.press("Enter").catch(()=>{});
  }

  await sleep(1200);

  // Identifica la riga prodotto che contiene il titolo (link blu)
  const row = page.locator(".js-product-row, .product, li").filter({ hasText: title }).first();

  // Se non trova con hasText preciso, prova con parole chiave (prima 25 char)
  const key = title.slice(0, 25);
  const row2 = page.locator(".js-product-row, .product, li").filter({ hasText: key }).first();

  let targetRow = row;
  const rowVisible = await targetRow.isVisible().catch(()=>false);
  if(!rowVisible){
    targetRow = row2;
  }

  const okVisible = await targetRow.isVisible().catch(()=>false);
  if(!okVisible){
    return { title, url: "", payhipId: "", reason: "ROW_NOT_FOUND" };
  }

  // Click Share / Embed sulla riga
  const shareBtn = targetRow.getByRole("button", { name: /share\s*\/\s*embed/i }).first();
  let clicked = false;
  try{
    await shareBtn.click({ timeout: 8000 });
    clicked = true;
  }catch{
    // fallback: pulsante con testo
    try{
      await targetRow.locator('button:has-text("Share / Embed")').first().click({ timeout: 8000 });
      clicked = true;
    }catch{}
  }

  if(!clicked){
    // fallback: apri "View" e poi cerca link /b/ nella pagina
    try{
      await targetRow.getByRole("button", { name: /^view$/i }).first().click({ timeout: 8000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(()=>{});
      await sleep(800);
      const body = await page.locator("body").innerText();
      const m = body.match(/https:\/\/payhip\.com\/b\/[A-Za-z0-9]+/);
      const url = m ? m[0] : "";
      const payhipId = extractPayhipId(url);
      // torna indietro
      await page.goBack({ waitUntil: "domcontentloaded" }).catch(()=>{});
      await sleep(800);
      return { title, url, payhipId, reason: url ? "" : "NO_B_LINK" };
    }catch{
      return { title, url: "", payhipId: "", reason: "SHARE_BUTTON_NOT_FOUND" };
    }
  }

  // Modal: estrai link /b/
  await sleep(900);
  const url = await extractBLinkFromModal(page);
  const payhipId = extractPayhipId(url);

  await closeModalIfAny(page);

  return { title, url, payhipId, reason: url ? "" : "NO_B_LINK" };
}

async function main(){
  const argv = process.argv.slice(2);
  const channel = argValue(argv, "--channel", "chrome");
  const headless = hasFlag(argv, "--headless");

  const productsPath = path.join(process.cwd(), "products.json");
  const linksPath = path.join(process.cwd(), "payhip_links.json");

  if(!fs.existsSync(productsPath)) throw new Error("Manca products.json nella cartella corrente");
  if(!fs.existsSync(linksPath)) throw new Error("Manca payhip_links.json nella cartella corrente");

  const products = loadJson(productsPath);
  const linksPayload = loadJson(linksPath);
  const links = Array.isArray(linksPayload) ? linksPayload : (linksPayload.items || []);
  if(!Array.isArray(products)) throw new Error("products.json non è un array");
  if(!Array.isArray(links)) throw new Error("payhip_links.json non contiene items[]");

  const have = new Set(links.map(x => normTitle(x.title)));
  const missing = products
    .map(p => String(p.title || ""))
    .filter(t => t.trim().length)
    .filter(t => !have.has(normTitle(t)));

  console.log("MANCANTI DA RECUPERARE:", missing.length);
  if(missing.length === 0){
    console.log("Niente da fare.");
    return;
  }

  const userDataDir = path.join(__dirname, ".payhip_user_data");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    channel,
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  console.log("\nLOGIN: si apre Payhip. Esegua login nel browser, poi torni qui e prema INVIO.\n");
  await page.goto("https://payhip.com/dashboard", { waitUntil: "domcontentloaded" });
  await waitEnter("PREMI INVIO PER RECUPERARE I LINK MANCANTI... ");

  const u = page.url();
  if (u.includes("/auth/login") || u.includes("/login")) {
    console.log("Sembra ancora su login: completi eventuale 2FA e attenda il redirect, poi ripeta il comando.");
    await context.close();
    process.exit(2);
  }

  await ensureProductsPage(page);

  const found = [];
  for(let i=0; i<missing.length; i++){
    const t = missing[i];
    console.log(`\n[${i+1}/${missing.length}]`, t);
    const r = await fetchOne(page, t);
    console.log(r.url ? ("OK " + r.url) : ("FAIL " + r.reason));
    found.push(r);
  }

  const outMissing = {
    generatedAt: new Date().toISOString(),
    count: found.length,
    items: found
  };
  fs.writeFileSync(path.join(process.cwd(), "payhip_missing_links.json"), JSON.stringify(outMissing, null, 2), "utf8");

  // merge: payhip_links.json + trovati validi
  const mergedMap = new Map();
  for(const it of links){
    const k = normTitle(it.title);
    if(!k) continue;
    mergedMap.set(k, {
      title: it.title,
      url: it.url || (it.payhipId ? `https://payhip.com/b/${it.payhipId}` : ""),
      payhipId: it.payhipId || extractPayhipId(it.url)
    });
  }
  for(const it of found){
    const k = normTitle(it.title);
    if(!k) continue;
    if(it.url){
      mergedMap.set(k, { title: it.title, url: it.url, payhipId: it.payhipId || extractPayhipId(it.url) });
    }
  }

  const merged = Array.from(mergedMap.values()).sort((a,b) => String(a.title).localeCompare(String(b.title)));
  fs.writeFileSync(path.join(process.cwd(), "payhip_links_merged.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), count: merged.length, items: merged }, null, 2),
    "utf8"
  );

  console.log("\nOK. Salvati: payhip_missing_links.json + payhip_links_merged.json");
  await context.close();
}

main().catch(e=>{
  console.error("FATAL:", e && e.message ? e.message : e);
  process.exit(1);
});
