#!/usr/bin/env node
/**
 * scrape_entrepedia_app_products_playwright.js  (V2)
 *
 * Scrape DIRETTO dall'APP (app.entrepedia.co) con Playwright loggato.
 * Migliora l'estrazione includendo anche le "prime parole" / riga iniziale che spesso indicano la tipologia
 * (Prompt Pack, Template, Workbook, ecc.), che nella V1 veniva persa perché filtravamo solo testi lunghi.
 *
 * INPUT:  URL tipo https://app.entrepedia.co/library/product/<UUID>
 * OUTPUT: JSON {generatedAt, count, products:[{sourceUrl,title,description,type,inferredType} ...]}
 *
 * USO:
 *   node scrape_entrepedia_app_products_playwright.js --in urls_all_app.txt --out entrepedia_products_ALL_APP.json --channel chrome
 *
 * NOTE:
 * - Usa profilo persistente in ./pw-entrepedia-app-profile (mantiene login).
 * - Se la prima volta non sei loggato, fai login quando si apre Chromium e poi lascia lavorare.
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

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
function extractUuid(s){
  const m = String(s||"").match(UUID_RE);
  return m ? m[0].toLowerCase() : null;
}

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
  const type  = (o.type || o.productType || o.category || o.product_category || o.kind);
  let score = 0;
  if(typeof title === "string" && title.trim().length >= 4) score += 5;
  if(typeof desc  === "string" && desc.trim().length >= 20) score += 3;
  if(typeof type  === "string" && type.trim().length >= 3) score += 3;

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
      if(keys.length < 3 || keys.length > 120) return;
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

function inferTypeFromText(txt){
  const t = String(txt||"").toLowerCase();
  const rules = [
    { rx: /\bprompt\s*pack(s)?\b|\bchatgpt\s*prompt(s)?\b|\bprompts?\b/, type: "Prompt Packs" },
    { rx: /\btemplate(s)?\b|\bcanva\s*template(s)?\b|\bnotion\s*template(s)?\b/, type: "Templates" },
    { rx: /\bworkbook(s)?\b/, type: "Workbooks" },
    { rx: /\bplanner(s)?\b|\btracker(s)?\b|\bjournal(s)?\b|\bhabit\b/, type: "Planners" },
    { rx: /\bchecklist(s)?\b/, type: "Checklists" },
    { rx: /\bguide(s)?\b/, type: "Guides" },
    { rx: /\bscript(s)?\b|\byoutube\s*script(s)?\b|\bpodcast\s*script(s)?\b/, type: "Scripts" },
    { rx: /\bswipe\s*file(s)?\b/, type: "Swipe Files" },
    { rx: /\bgraphics?\b|\bclipart\b|\bicons?\b|\bsvg\b|\bpng\b/, type: "Graphics" }
  ];
  for(const r of rules){
    if(r.rx.test(t)) return r.type;
  }
  return "";
}

async function extractTopTextBlock(page){
  return await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    if(!h1) return { title: "", lead: [], descLong: "" };

    const title = (h1.textContent || "").trim();

    const lead = [];
    const root = h1.parentElement || h1;

    const textFrom = (el) => (el && el.textContent ? el.textContent.trim() : "");

    const all = Array.from(root.querySelectorAll("*")).slice(0, 80);
    for(const el of all){
      if(el === h1) continue;
      const t = textFrom(el);
      if(!t) continue;

      if(/^\$?\d+(\.\d+)?$/.test(t)) continue;
      if(/\b(usd|eur|gbp)\b/i.test(t) && t.length <= 10) continue;
      if(/\b(add to cart|buy now|checkout|download)\b/i.test(t)) continue;

      const lines = t.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      for(const ln of lines){
        if(ln.length < 3) continue;
        if(ln.length > 90) continue;
        if(lead.includes(ln)) continue;
        lead.push(ln);
        if(lead.length >= 6) break;
      }
      if(lead.length >= 6) break;
    }

    const longParts = [];
    const candidates = Array.from(document.querySelectorAll("p, li, div")).slice(0, 400);
    for(const el of candidates){
      const t = textFrom(el);
      if(!t) continue;
      if(t.length < 120) continue;
      if(/\b(add to cart|buy now|checkout)\b/i.test(t)) continue;
      longParts.push(t);
      if(longParts.length >= 4) break;
    }

    return { title, lead, descLong: longParts.join("\n\n").trim() };
  });
}

(async () => {
  const argv = process.argv.slice(2);
  const inFile  = argValue(argv, "--in", "urls_all_app.txt");
  const outFile = argValue(argv, "--out", "entrepedia_products_ALL_APP.json");
  const channel = argValue(argv, "--channel", "chrome");
  const limit   = Number(argValue(argv, "--limit", "0"));
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
      let inferredType = "";

      if(currentJsonBest){
        title = safeText(currentJsonBest.title || currentJsonBest.name || currentJsonBest.productTitle || "").trim();
        description = safeText(currentJsonBest.description || currentJsonBest.productDescription || currentJsonBest.longDescription || currentJsonBest.summary || "").trim();
        type = safeText(currentJsonBest.type || currentJsonBest.productType || currentJsonBest.category || currentJsonBest.kind || "").trim();
      }

      const dom = await extractTopTextBlock(page);
      if((!title || title.length < 4) && dom.title) title = dom.title;

      const leadTxt = (dom.lead || []).join("\n").trim();
      const longTxt = dom.descLong || "";

      const combined = [leadTxt, description, longTxt].filter(s => s && s.trim()).join("\n\n").trim();
      if(combined && combined.length >= 20) description = combined;

      inferredType = type || inferTypeFromText(leadTxt) || inferTypeFromText(description);

      if(description){
        description = description
          .split(/\r?\n/)
          .filter(ln => ln.trim() !== "ZIP")
          .join("\n")
          .replace(/\n{4,}/g, "\n\n\n")
          .trim();
      }

      if(!title || title.length < 4){
        fails.push({ idx: i+1, url, reason: "NO_TITLE" });
        console.log(`[${i+1}/${targets.length}] MISS`);
        continue;
      }

      const id = extractUuid(url);

      products.push({
        id,
        sourceUrl: url,
        title,
        description,
        type,
        inferredType
      });

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
