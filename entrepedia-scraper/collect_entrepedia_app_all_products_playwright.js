#!/usr/bin/env node
/**
 * collect_entrepedia_app_all_products_playwright.js
 *
 * Colleziona TUTTI gli URL prodotto dalla library dell'APP Entrepedia:
 *   https://app.entrepedia.co/library/product/<ID>
 *
 * USO:
 *   node collect_entrepedia_app_all_products_playwright.js --out urls_all_app.txt --channel chrome
 *
 * NOTE:
 * - Browser non headless: se non sei loggato, fai login e poi NON toccare nulla.
 * - Output: urls_all_app.txt (un URL per riga) + debug_app_all.html/.png
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function argValue(argv, key, defVal=null){
  const i = argv.indexOf(key);
  return i === -1 ? defVal : (argv[i+1] ?? defVal);
}
function uniq(arr){ return Array.from(new Set(arr)); }
function ensureAbsApp(u){
  if(!u) return "";
  if(u.startsWith("http://") || u.startsWith("https://")) return u;
  return "https://app.entrepedia.co" + (u.startsWith("/") ? u : ("/" + u));
}

(async () => {
  const argv = process.argv.slice(2);
  const out = argValue(argv, "--out", "urls_all_app.txt");
  const channel = argValue(argv, "--channel", "chrome");
  const maxScrolls = Number(argValue(argv, "--max-scrolls", "220"));
  const waitMs = Number(argValue(argv, "--wait", "900"));

  const url = "https://app.entrepedia.co/library";

  const browser = await chromium.launch({ headless: false, channel });
  const page = await browser.newPage();

  console.log("OPEN:", url);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  // se non loggato, ti lascia il tempo per login
  try{
    await page.waitForSelector('a[href*="/library"]', { timeout: 20000 });
  }catch(e){
    console.log("LOGIN: se vedi login, effettua login ora (hai ~120s)...");
    try{
      await page.waitForSelector('a[href*="/library"]', { timeout: 120000 });
    }catch(_){}
  }

  // scrolling + load more
  let prevCount = 0;
  let stable = 0;

  for(let i=0; i<maxScrolls; i++){
    const loadBtn = page.locator("text=/load more/i").first();
    if(await loadBtn.isVisible().catch(()=>false)){
      await loadBtn.click().catch(()=>{});
      await page.waitForTimeout(waitMs);
    }else{
      await page.mouse.wheel(0, 3200);
      await page.waitForTimeout(waitMs);
    }

    const count = await page.locator('a[href*="/library/product/"]').count().catch(()=>0);
    if(count > prevCount){
      prevCount = count;
      stable = 0;
    }else{
      stable++;
      if(stable >= 10) break;
    }
  }

  const hrefs = await page.$$eval('a[href*="/library/product/"]', as =>
    as.map(a => a.getAttribute("href") || "").filter(Boolean)
  );

  const urls = uniq(hrefs.map(ensureAbsApp))
    .filter(u => /\/library\/product\//i.test(u))
    .sort();

  const outPath = path.resolve(process.cwd(), out);
  fs.writeFileSync(outPath, urls.join("\n") + (urls.length ? "\n" : ""), "utf8");

  const html = await page.content();
  fs.writeFileSync(path.resolve(process.cwd(), "debug_app_all.html"), html, "utf8");
  await page.screenshot({ path: path.resolve(process.cwd(), "debug_app_all.png"), fullPage: true }).catch(()=>{});

  console.log("OK. Salvato:", outPath, "(", urls.length, "link )");
  console.log("DEBUG: debug_app_all.html + debug_app_all.png");

  await browser.close();
})().catch(err => {
  console.error("FATAL:", err?.message || err);
  process.exit(1);
});
