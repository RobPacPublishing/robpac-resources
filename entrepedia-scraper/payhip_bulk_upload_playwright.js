#!/usr/bin/env node
/**
 * payhip_bulk_upload_playwright.js — robust submit + fuzzy anti-duplicati + debug dump
 *
 * Fix principali:
 * - ADD_BUTTON_NOT_FOUND: fallback su qualsiasi submit (button/a/input) + form.submit()
 * - Anti-duplicati: match "fuzzy" sul titolo (ignora punteggiatura/apostrofi/suffissi tipo "- Ebook")
 * - Se manca il file digitale (zip/pdf): FAIL_MISSING_DIGITAL_FILE (non prova a creare)
 * - Debug automatico su FAIL: salva screenshot + HTML in payhip_upload_debug/
 *
 * USO:
 *   node payhip_bulk_upload_playwright.js --in <payload.json> --channel chrome
 *   node payhip_bulk_upload_playwright.js --in <payload.json> --rerun-fails <results.json> --channel chrome
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { chromium } = require("playwright");

function argValue(argv, name, def = null) {
  const i = argv.indexOf(name);
  if (i === -1) return def;
  const v = argv[i + 1];
  if (!v || v.startsWith("--")) return def;
  return v;
}
function hasArg(argv, name) { return argv.includes(name); }
function die(msg) { console.error("FATAL:", msg); process.exit(1); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function safeSlug(s){
  return (s || "item")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/['"’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "item";
}

function normalizeTitleLoose(s){
  return (s || "")
    .toString()
    .toLowerCase()
    .replace(/\u00A0/g, " ")
    .replace(/[’'`"]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isFuzzyMatch(a, b){
  const A = normalizeTitleLoose(a);
  const B = normalizeTitleLoose(b);
  if(!A || !B) return false;
  if(A === B) return true;

  const stripSuffix = (x) => x.replace(/\b(e book|ebook|book)\b/g, "").replace(/\s+/g, " ").trim();
  const A2 = stripSuffix(A);
  const B2 = stripSuffix(B);
  if(A2 && B2 && A2 === B2) return true;

  if(A.length >= 12 && (B.includes(A) || A.includes(B))) return true;
  if(A2.length >= 12 && (B2.includes(A2) || A2.includes(B2))) return true;

  return false;
}

function loadPayload(p){
  const raw = fs.readFileSync(p, "utf8");
  const data = JSON.parse(raw);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.products)) return data.products;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

function loadFailTitles(resultsPath){
  const raw = fs.readFileSync(resultsPath, "utf8");
  const data = JSON.parse(raw);
  const arr = Array.isArray(data) ? data : (data && Array.isArray(data.results) ? data.results : []);
  const fails = [];
  for(const r of arr){
    const status = (r.status || r.result || "").toString().toLowerCase();
    const title = r.title || r.name || r.productTitle;
    if(!title) continue;
    if(status.startsWith("fail") || status === "error" || status === "ko") fails.push(title);
  }
  return fails;
}

async function waitEnter(prompt){
  process.stdout.write(prompt);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise(resolve => rl.question("", () => { rl.close(); resolve(); }));
}

async function ensureLoggedIn(page){
  await page.goto("https://payhip.com/dashboard", { waitUntil: "domcontentloaded" }).catch(()=>{});
  const url = page.url();
  const looksLoggedOut = /sign_in|login|session|users\/sign_in/i.test(url);
  if(looksLoggedOut){
    console.log('LOGIN: si apre Payhip. Esegua login nel browser, poi torni qui e prema INVIO.');
    await waitEnter("");
    await page.goto("https://payhip.com/dashboard", { waitUntil: "domcontentloaded" });
  }
}

async function gotoProductsAll(page){
  await page.goto("https://payhip.com/products", { waitUntil: "domcontentloaded" });
  const allTab = page.locator("a").filter({ hasText: /All\s*\(/i }).first();
  if(await allTab.count()){
    await allTab.click().catch(()=>{});
    await page.waitForTimeout(600);
  }
}

async function searchProductByTitle(page, title){
  await gotoProductsAll(page);

  const searchInput = page.locator('input[placeholder*="Search for product"], input[name="search"], input[type="search"]').first();
  const searchBtn = page.locator('button:has-text("Search"), input[type="submit"][value="Search"]').first();

  if(!await searchInput.count()){
    return { found:false, href:null, mode:"NO_SEARCH_INPUT" };
  }

  await searchInput.fill("");
  await searchInput.fill(title);
  if(await searchBtn.count()) await searchBtn.click().catch(()=>{});
  else await searchInput.press("Enter").catch(()=>{});
  await page.waitForTimeout(900);

  const titleLinks = page.locator(".js-product-row li.name a");
  const n = await titleLinks.count();
  for(let i=0; i<n; i++){
    const a = titleLinks.nth(i);
    const t = (await a.innerText().catch(()=> "")).trim();
    if(isFuzzyMatch(t, title)){
      const href = await a.getAttribute("href").catch(()=>null);
      return { found:true, href: href || null, mode:"FUZZY_MATCH", matched: t };
    }
  }
  return { found:false, href:null, mode:"NOT_FOUND" };
}

async function handleUploadingDialog(page){
  const dialogText = page.locator('text=Please wait there are files still being uploaded.').first();
  if(await dialogText.count()){
    const okBtn = page.getByRole("button", { name: /^OK$/i }).first();
    if(await okBtn.count()) await okBtn.click().catch(()=>{});
    return true;
  }
  return false;
}

async function setFileSmart(page, filePath, kind){
  const inputs = page.locator('input[type="file"]');
  const n = await inputs.count();
  if(!n) return false;

  const preferImage = kind === "image";
  for(let i=0;i<n;i++){
    const el = inputs.nth(i);
    const accept = (await el.getAttribute("accept").catch(()=> "")) || "";
    const name = (await el.getAttribute("name").catch(()=> "")) || "";
    const looksImage = /image/i.test(accept) || /image|cover|thumbnail|photo|avatar/i.test(name);
    if(preferImage && !looksImage) continue;
    if(!preferImage && looksImage) continue;
    try{
      await el.setInputFiles(filePath);
      return true;
    }catch(e){}
  }
  try{
    await inputs.first().setInputFiles(filePath);
    return true;
  }catch(e){
    return false;
  }
}

async function fillFirstWorking(page, candidates, value){
  for(const c of candidates){
    try{
      const loc = typeof c === "string" ? page.locator(c).first() : c;
      if(await loc.count()){
        await loc.waitFor({ state: "visible", timeout: 8000 }).catch(()=>{});
        await loc.fill(value);
        return true;
      }
    }catch(e){}
  }
  return false;
}

async function fillDescription(page, text){
  try{
    const byLabel = page.getByLabel(/description/i).first();
    if(await byLabel.count()){
      await byLabel.fill(text);
      return true;
    }
  }catch(e){}

  const ok = await fillFirstWorking(page, [
    'textarea[name="description"]',
    'textarea#description',
    'textarea[name="product[description]"]',
    'textarea'
  ], text);
  if(ok) return true;

  const trix = page.locator("trix-editor").first();
  if(await trix.count()){
    await trix.click();
    await trix.fill(text).catch(()=>{});
    return true;
  }
  const ce = page.locator('[contenteditable="true"]').first();
  if(await ce.count()){
    await ce.click();
    await ce.fill(text).catch(()=>{});
    return true;
  }
  return false;
}

async function clickAnySubmit(page){
  const candidates = [
    page.getByRole("button", { name: /Add Product/i }).first(),
    page.getByRole("button", { name: /Create/i }).first(),
    page.getByRole("button", { name: /Publish/i }).first(),
    page.getByRole("button", { name: /Save/i }).first(),
    page.getByRole("button", { name: /Continue/i }).first(),
    page.locator('button[type="submit"]').first(),
    page.locator('input[type="submit"]').first(),
    page.locator('a:has-text("Add Product")').first(),
    page.locator('a:has-text("Create")').first(),
    page.locator('a:has-text("Publish")').first(),
    page.locator('a:has-text("Save")').first(),
  ];

  for(const loc of candidates){
    try{
      if(await loc.count()){
        await loc.scrollIntoViewIfNeeded().catch(()=>{});
        await loc.click({ timeout: 8000 }).catch(()=>{});
        return { clicked:true, how:"CLICK_LOCATOR" };
      }
    }catch(e){}
  }

  try{
    const forms = page.locator("form");
    const n = await forms.count();
    if(n){
      for(let i=n-1; i>=0; i--){
        const f = forms.nth(i);
        const box = await f.boundingBox().catch(()=>null);
        if(!box) continue;
        await f.evaluate((form)=>form.requestSubmit ? form.requestSubmit() : form.submit()).catch(()=>{});
        return { clicked:true, how:"FORM_SUBMIT" };
      }
    }
  }catch(e){}

  try{
    await page.keyboard.press("Enter").catch(()=>{});
    return { clicked:true, how:"KEY_ENTER" };
  }catch(e){}

  return { clicked:false, how:"NONE" };
}

async function dumpDebug(page, title, reason){
  const dir = path.resolve(process.cwd(), "payhip_upload_debug");
  try{ fs.mkdirSync(dir, { recursive:true }); }catch(e){}
  const stamp = nowStamp();
  const base = `${stamp}_${safeSlug(title)}_${reason}`;
  const png = path.join(dir, `${base}.png`);
  const html = path.join(dir, `${base}.html`);
  const url = page.url();

  try{ await page.screenshot({ path: png, fullPage: true }); }catch(e){}
  try{
    const content = await page.content().catch(()=> "");
    fs.writeFileSync(html, `<!-- URL: ${url} -->\n` + content, "utf8");
  }catch(e){}
  return { png, html, url };
}

async function createOne(page, item){
  const title = item.title || item.name || item.productTitle;
  if(!title) return { ok:false, reason:"MISSING_TITLE" };

  const filePathRaw = item.file || item.filePath || item.download || item.asset || null;
  let fileAbs = null;
  if(filePathRaw){
    fileAbs = path.isAbsolute(filePathRaw) ? filePathRaw : path.resolve(process.cwd(), filePathRaw);
  }
  if(!fileAbs || !fs.existsSync(fileAbs)){
    return { ok:false, reason:"FAIL_MISSING_DIGITAL_FILE" };
  }

  await page.goto("https://payhip.com/product/addit", { waitUntil: "domcontentloaded" });

  const titleOk = await fillFirstWorking(page, [
    page.getByLabel(/product name|name/i).first(),
    'input[name="name"]',
    'input#name',
    'input[name="title"]',
    'input#title',
    'input[type="text"]'
  ], title);
  if(!titleOk) return { ok:false, reason:"TITLE_FIELD_NOT_FOUND" };

  const priceVal = (item.price ?? item.amount ?? item.usd ?? item.priceUsd);
  const price = (priceVal !== undefined && priceVal !== null) ? String(priceVal) : null;
  if(price){
    await fillFirstWorking(page, [
      page.getByLabel(/price/i).first(),
      'input[name="price"]',
      'input#price',
      'input[name="amount"]'
    ], price);
  }

  const desc = item.description || item.desc || "";
  if(desc) await fillDescription(page, desc).catch(()=>{});

  await setFileSmart(page, fileAbs, "digital");
  await page.waitForTimeout(700);

  const coverPathRaw = item.cover || item.coverPath || item.image || item.thumbnail || null;
  if(coverPathRaw){
    const coverAbs = path.isAbsolute(coverPathRaw) ? coverPathRaw : path.resolve(process.cwd(), coverPathRaw);
    if(fs.existsSync(coverAbs)){
      await setFileSmart(page, coverAbs, "image").catch(()=>{});
      await page.waitForTimeout(500);
    }
  }

  let clicked = { clicked:false, how:"NONE" };
  for(let attempt=1; attempt<=10; attempt++){
    clicked = await clickAnySubmit(page);
    await page.waitForTimeout(900);
    const hadDialog = await handleUploadingDialog(page);
    if(hadDialog){
      await sleep(2500 + attempt*1500);
      continue;
    }
    break;
  }
  if(!clicked.clicked){
    return { ok:false, reason:"ADD_BUTTON_NOT_FOUND" };
  }

  let createdUrl = null;
  try{
    const inputLink = page.locator('input[value^="https://payhip.com/b/"], input[value^="http://payhip.com/b/"]').first();
    if(await inputLink.count()){
      createdUrl = await inputLink.inputValue().catch(()=>null);
    }
  }catch(e){}

  return { ok:true, createdUrl, submitHow: clicked.how };
}

async function main(){
  const argv = process.argv.slice(2);
  const inPath = argValue(argv, "--in");
  if(!inPath) die('manca --in <payload.json>');
  const payloadPath = path.resolve(process.cwd(), inPath);
  if(!fs.existsSync(payloadPath)) die(`file non trovato: ${payloadPath}`);

  const channel = argValue(argv, "--channel", "chrome");
  const headless = hasArg(argv, "--headless");
  const userDataDir = path.resolve(process.cwd(), argValue(argv, "--user-data", ".pw-payhip-user-data"));

  const rerunFailsPath = argValue(argv, "--rerun-fails", null);
  const stamp = nowStamp();
  const resultsPath = path.resolve(process.cwd(), `payhip_upload_results_${stamp}.json`);

  let items = loadPayload(payloadPath);
  if(!items.length) die("payload vuoto o non riconosciuto");

  if(rerunFailsPath){
    const rp = path.resolve(process.cwd(), rerunFailsPath);
    if(!fs.existsSync(rp)) die(`--rerun-fails non trovato: ${rp}`);
    const failTitles = loadFailTitles(rp);
    const failSetLoose = new Set(failTitles.map(t => normalizeTitleLoose(t)));
    items = items.filter(it => {
      const t = it.title || it.name || "";
      return failSetLoose.has(normalizeTitleLoose(t));
    });
    if(!items.length){
      console.log("Nessun FAIL da rerunnare (incrocio vuoto). Esco.");
      process.exit(0);
    }
  }

  const browser = await chromium.launchPersistentContext(userDataDir, { headless, channel });
  const page = await browser.newPage();

  await ensureLoggedIn(page);

  const results = [];
  console.log(`PAYLOAD: ${items.length} prodotti da processare`);
  if(rerunFailsPath) console.log(`RERUN FAILS da: ${rerunFailsPath}`);

  for(let i=0; i<items.length; i++){
    const item = items[i];
    const title = item.title || item.name || item.productTitle || "(senza titolo)";
    console.log(`\n[${i+1}/${items.length}] CREATE "${title}"`);

    const exists = await searchProductByTitle(page, title).catch(()=>({found:false, href:null}));
    if(exists.found){
      console.log("SKIP: già presente su Payhip");
      results.push({ title, status:"SKIP_EXISTS", href: exists.href || null, matched: exists.matched || null });
      continue;
    }

    const created = await createOne(page, item);
    if(!created.ok){
      if(created.reason === "ADD_BUTTON_NOT_FOUND" || created.reason === "TITLE_FIELD_NOT_FOUND"){
        const dbg = await dumpDebug(page, title, created.reason);
        console.log(`FAIL ${created.reason} (debug: ${path.basename(dbg.png)})`);
        results.push({ title, status:"FAIL", reason: created.reason, debug: dbg });
      } else {
        console.log("FAIL", created.reason);
        results.push({ title, status:"FAIL", reason: created.reason });
      }
      continue;
    }

    // Verifica che esista davvero in lista
    let href = created.createdUrl || null;
    if(!href){
      const check = await searchProductByTitle(page, title).catch(()=>({found:false, href:null}));
      if(check.found){
        href = check.href || null;
        console.log("OK (verificato via /products search)");
        results.push({ title, status:"OK", href, note:"VERIFIED_BY_SEARCH", submitHow: created.submitHow });
      } else {
        const dbg = await dumpDebug(page, title, "SUBMIT_NO_SUCCESS_SIGNAL");
        console.log("FAIL SUBMIT_NO_SUCCESS_SIGNAL");
        results.push({ title, status:"FAIL", reason:"SUBMIT_NO_SUCCESS_SIGNAL", submitHow: created.submitHow, debug: dbg });
      }
    } else {
      console.log("OK");
      results.push({ title, status:"OK", href, submitHow: created.submitHow });
    }
  }

  const outObj = { generatedAt: new Date().toISOString(), in: payloadPath, count: results.length, results };
  fs.writeFileSync(resultsPath, JSON.stringify(outObj, null, 2), "utf8");
  console.log(`\nDONE. Salvato: ${resultsPath}`);

  await browser.close();
}

main().catch(err => {
  console.error("FATAL:", err?.stack || err?.message || err);
  process.exit(1);
});
