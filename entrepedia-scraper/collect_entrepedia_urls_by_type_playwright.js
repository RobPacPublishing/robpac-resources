#!/usr/bin/env node
/**
 * collect_entrepedia_urls_by_type_playwright_V2.js (debug+regex)
 *
 * Estrae URL prodotto da una pagina tipologia Entrepedia anche se i link non sono <a href>.
 * Salva anche debug_page.html + debug_hrefs.txt + debug_page.png per diagnosi.
 *
 * USO:
 *   node collect_entrepedia_urls_by_type_playwright_V2.js --url "https://www.entrepedia.co/plr-digital-products/prompt-packs" --out urls_prompt.txt --channel chrome
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function argValue(argv, key, defVal=null){
  const i = argv.indexOf(key);
  return i === -1 ? defVal : (argv[i+1] ?? defVal);
}
function ensureAbsUrl(u){
  if(!u) return "";
  if(u.startsWith("http://") || u.startsWith("https://")) return u;
  const base = "https://www.entrepedia.co";
  return base + (u.startsWith("/") ? u : ("/" + u));
}
function uniq(arr){ return Array.from(new Set(arr)); }

function extractByRegex(html){
  const out = [];

  // www domain, all-products
  const re1 = /(?:https?:\/\/www\.entrepedia\.co)?(\/plr-digital-products\/all-products\/[a-z0-9-]+)\/?/gi;
  let m;
  while((m = re1.exec(html)) !== null){
    out.push(ensureAbsUrl(m[1]));
  }

  // app domain (se la pagina inserisce link/app redirect)
  const re2 = /https?:\/\/app\.entrepedia\.co\/[^"\s<>]+/gi;
  while((m = re2.exec(html)) !== null){
    out.push(m[0]);
  }

  // fallback: qualsiasi /plr-digital-products/<slug> che non sia pagina elenco
  const re3 = /(?:https?:\/\/www\.entrepedia\.co)?(\/plr-digital-products\/[a-z0-9-]+)\/?/gi;
  const blacklist = new Set([
    "plr-digital-products",
    "all-products",
    "prompt-packs",
    "plr-courses",
    "templates",
    "ebooks",
    "guides",
    "workbooks",
    "audio",
    "videos",
    "ai-prompts",
    "freebies"
  ]);
  while((m = re3.exec(html)) !== null){
    const slug = String(m[1] || "").split("/").filter(Boolean).pop().toLowerCase();
    if(slug && !blacklist.has(slug)){
      out.push(ensureAbsUrl(m[1]));
    }
  }

  return uniq(out);
}

(async () => {
  const argv = process.argv.slice(2);
  const url = argValue(argv, "--url", null);
  const out = argValue(argv, "--out", "urls.txt");
  const channel = argValue(argv, "--channel", null);
  const maxClicks = Number(argValue(argv, "--max-clicks", "350"));

  if(!url){
    console.error('FATAL: manca --url "<pagina tipologia>"');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false, channel: channel || undefined });
  const page = await browser.newPage();

  console.log("OPEN:", url);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  // prova a chiudere eventuali banner/cookie senza fallire
  const maybeClicks = [
    'button:has-text("Accept")',
    'button:has-text("I agree")',
    'button:has-text("OK")',
    'button:has-text("Got it")'
  ];
  for(const sel of maybeClicks){
    const loc = page.locator(sel).first();
    if(await loc.isVisible().catch(()=>false)){
      await loc.click().catch(()=>{});
      await page.waitForTimeout(500);
      break;
    }
  }

  let clicks = 0;
  while(clicks < maxClicks){
    const btn = page.locator("text=/load more/i").first();
    const visible = await btn.isVisible().catch(()=>false);
    if(!visible) break;
    await btn.click().catch(()=>{});
    clicks++;
    await page.waitForTimeout(1200);
  }

  const html = await page.content();
  fs.writeFileSync(path.resolve(process.cwd(), "debug_page.html"), html, "utf8");
  await page.screenshot({ path: path.resolve(process.cwd(), "debug_page.png"), fullPage: true }).catch(()=>{});

  const hrefs = await page.$$eval("a[href]", as => as.map(a => a.getAttribute("href") || ""));
  fs.writeFileSync(
    path.resolve(process.cwd(), "debug_hrefs.txt"),
    uniq(hrefs.filter(Boolean)).sort().join("\n") + "\n",
    "utf8"
  );

  let links = [];
  const absHrefs = hrefs.map(h => ensureAbsUrl(h)).filter(Boolean);
  links.push(...absHrefs.filter(h => h.includes("/plr-digital-products/")));
  links.push(...extractByRegex(html));

  links = uniq(links)
    .filter(u => u && (u.includes("entrepedia.co") || u.includes("app.entrepedia.co")))
    .sort();

  const outPath = path.resolve(process.cwd(), out);
  fs.writeFileSync(outPath, links.join("\n") + (links.length ? "\n" : ""), "utf8");
  console.log("OK. Salvato:", outPath, "(", links.length, "link )");
  console.log("DEBUG: debug_page.html, debug_hrefs.txt, debug_page.png");

  await browser.close();
})().catch(err => {
  console.error("FATAL:", err?.message || err);
  process.exit(1);
});
