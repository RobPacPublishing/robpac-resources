#!/usr/bin/env node
/**
 * scrape_entrepedia_app_products_playwright.js
 *
 * Scrape dei prodotti DIRETTAMENTE dall'APP (app.entrepedia.co) usando Playwright loggato.
 * Legge URL tipo: https://app.entrepedia.co/library/product/<ID>
 * ed estrae (best-effort): title, description, type (se presente), sourceUrl.
 *
 * USO:
 *   node scrape_entrepedia_app_products_playwright.js --in urls_all_app.txt --out entrepedia_products_app.json --channel chrome
 *
 * NOTE:
 * - Usa profilo persistente in ./pw-entrepedia-app-profile (mantiene login).
 * - La prima volta potrebbe chiedere login: fallo e poi NON toccare nulla.
 * - Output: JSON con {generatedAt, count, products:[...]} + debug_app_scrape_fails.txt
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function argValue(argv, key, defVal=null){
  const i = argv.indexOf(key);
  return i === -1 ? defVal : (argv[i+1] ?? defVal);
}
function readLines(p){
  return fs.readFileSync(p, "utf8").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}
function uniq(arr){ return Array.from(new Set(arr)); }

function safeText(x){
  if(x == null) return "";
  if(typeof x === "string") return x;
  return String(x);
}

function walk(obj, cb){
  if(obj == null) return;
  const t = typeof obj;
  if(t !== "object") return;
  if(Array.isArray(obj)){
    for(const v of obj) walk(v, cb);
    return;
  }
  cb(obj);
  for(const k of Object.keys(obj)) walk(obj[k], cb);
}

function scoreCandidate(o){
  const title = (o.title || o.name || o.productTitle || o.product_name);
  const desc  = (o.description || o.productDescription || o.longDescription || o.summary);
  const type  = (o.type || o.productType || o.category || o.product_category);
  let score = 0;
  if(typeof title === "string" && title.trim().length >= 4) score += 5;
  if(typeof desc  === "string" && desc.trim().length >= 40) score += 5;
  if(typeof type  === "string" && type.trim().length >= 3) score += 2;

  const blob = JSON.stringify(o).toLowerCase();
  if(blob.includes("sign-in") || blob.includes("forgot-password") || blob.includes("csrf")) score -= 10;

  return score;
}

function pickBestProductObject(json){
  let best = null;
  let bestScore = -1;

  try{
    walk(json, (o) => {
      const keys = Object.keys(o);
      if(keys.length < 3 || keys.length > 80) return;
      const s = scoreCandidate(o);
      if(s > bestScore){
        bestScore = s;
        best = o;
      }
    });
  }catch(e){}

  if(bestScore < 6) return null;
  return best;
}

async function getPageText(page){
  const title = await page.locator("h1").first().textContent().catch(()=> "") || "";
  const paras = await page.$$eval("p, div", els => {
    const out = [];
    for(const el of els){
      const t = (el.textContent || "").trim();
      if(t.length >= 120) out.push(t);
    }
    return out.slice(0, 4);
  }).catch(()=>[]);
  const description = (paras || []).join("\n\n").trim();
  return { title: title.trim(), description };
}

(async () => {
  const argv = process.argv.slice(2);
  const inFile  = argValue(argv, "--in", "urls_all_app.txt");
  const outFile = argValue(argv, "--out", "entrepedia_products_app.json");
  const channel = argValue(argv, "--channel", "chrome");
  const limit   = Number(argValue(argv, "--limit", "0")); // 0 = tutti
  const profileDir = path.resolve(process.cwd(), "pw-entrepedia-app-profile");

  const inPath = path.resolve(process.cwd(), inFile);
  if(!fs.existsSync(inPath)){
    console.error("Input mancante:", inPath);
    process.exit(1);
  }

  const urls = uniq(readLines(inPath)).filter(u => u.includes("/library/product/"));
  const targets = limit > 0 ? urls.slice(0, limit) : urls;

  const ctx = await chromium.launchPersistentContext(profileDir, { headless: false, channel });
  const page = await ctx.newPage();

  const products = [];
  const fails = [];

  let currentJsonBest = null;

  page.on("response", async (res) => {
    try{
      const ct = (res.headers()["content-type"] || "").toLowerCase();
      if(!ct.includes("json")) return;
      const txt = await res.text().catch(()=> "");
      if(!txt || txt.length < 2) return;
      let j;
      try{ j = JSON.parse(txt); }catch(_){ return; }
      const best = pickBestProductObject(j);
      if(best) currentJsonBest = best;
    }catch(e){}
  });

  for(let i=0; i<targets.length; i++){
    const url = targets[i];
    currentJsonBest = null;

    try{
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(900);

      const cur = page.url();
      if(cur.includes("/sign-in") || cur.includes("sign-in")){
        fails.push({ idx: i+1, url, reason: "NOT_LOGGED_IN" });
        console.log(`[${i+1}/${targets.length}] MISS (not logged in)`);
        continue;
      }

      let title = "";
      let description = "";
      let type = "";

      if(currentJsonBest){
        title = safeText(currentJsonBest.title || currentJsonBest.name || currentJsonBest.productTitle || "").trim();
        description = safeText(currentJsonBest.description || currentJsonBest.productDescription || currentJsonBest.longDescription || currentJsonBest.summary || "").trim();
        type = safeText(currentJsonBest.type || currentJsonBest.productType || currentJsonBest.category || "").trim();
      }

      if(!title || title.length < 4 || !description || description.length < 40){
        const dom = await getPageText(page);
        if((!title || title.length < 4) && dom.title) title = dom.title;
        if((!description || description.length < 40) && dom.description) description = dom.description;
      }

      if(!title || title.length < 4){
        fails.push({ idx: i+1, url, reason: "NO_TITLE" });
        console.log(`[${i+1}/${targets.length}] MISS`);
        continue;
      }

      products.push({ sourceUrl: url, title, description, type });
      console.log(`[${i+1}/${targets.length}] OK`);
    }catch(e){
      fails.push({ idx: i+1, url, reason: "ERROR", error: String(e?.message || e) });
      console.log(`[${i+1}/${targets.length}] ERROR`);
    }
  }

  const outPath = path.resolve(process.cwd(), outFile);
  fs.writeFileSync(outPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: products.length,
    products
  }, null, 2), "utf8");

  const failPath = path.resolve(process.cwd(), "debug_app_scrape_fails.txt");
  fs.writeFileSync(failPath, fails.map(f => `${f.idx}\t${f.reason}\t${f.url}`).join("\n") + (fails.length ? "\n" : ""), "utf8");

  console.log("OK. Salvato:", outPath, "(", products.length, "prodotti )");
  console.log("FAILS:", fails.length, "-> debug_app_scrape_fails.txt");

  await ctx.close();
})().catch(err => {
  console.error("FATAL:", err?.message || err);
  process.exit(1);
});
