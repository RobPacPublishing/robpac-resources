#!/usr/bin/env node
/**
 * app_product_to_public_urls_playwright.js
 *
 * Converte URL dell'app:
 *   https://app.entrepedia.co/library/product/<ID>
 * in URL pubblici su www.entrepedia.co (quando presenti nella pagina / nel traffico).
 *
 * USO:
 *   node app_product_to_public_urls_playwright.js --in urls_all_app.txt --out urls_all_public.txt --channel chrome
 *
 * NOTE:
 * - Usa un profilo persistente in ./pw-entrepedia-app-profile per mantenere login.
 * - Se la prima volta non sei loggato, fai login quando si apre Chromium.
 * - Output:
 *   - urls_all_public.txt (un URL per riga, deduplicato)
 *   - public_url_map.json (mappa dettagliata)
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function argValue(argv, key, defVal=null){
  const i = argv.indexOf(key);
  return i === -1 ? defVal : (argv[i+1] ?? defVal);
}
function uniq(arr){ return Array.from(new Set(arr)); }
function readLines(p){
  return fs.readFileSync(p, "utf8").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function extractPublicUrlsFromText(txt){
  const out = [];
  if(!txt) return out;

  // pattern principale
  const re1 = /https?:\/\/www\.entrepedia\.co\/plr-digital-products\/[\w-]+\/[\w-]+/gi;
  let m;
  while((m = re1.exec(txt)) !== null) out.push(m[0]);

  // fallback: all-products/slug
  const re2 = /https?:\/\/www\.entrepedia\.co\/plr-digital-products\/all-products\/[a-z0-9-]+/gi;
  while((m = re2.exec(txt)) !== null) out.push(m[0]);

  // fallback path
  const re3 = /\/plr-digital-products\/[\w-]+\/[\w-]+/gi;
  while((m = re3.exec(txt)) !== null) out.push("https://www.entrepedia.co" + m[0]);

  return out;
}

(async () => {
  const argv = process.argv.slice(2);
  const inFile = argValue(argv, "--in", "urls_all_app.txt");
  const outFile = argValue(argv, "--out", "urls_all_public.txt");
  const channel = argValue(argv, "--channel", "chrome");
  const limit = Number(argValue(argv, "--limit", "0")); // 0 = nessun limite
  const profileDir = path.resolve(process.cwd(), "pw-entrepedia-app-profile");

  const inPath = path.resolve(process.cwd(), inFile);
  if(!fs.existsSync(inPath)){
    console.error("Input mancante:", inPath);
    process.exit(1);
  }

  const appUrls = readLines(inPath);
  const targets = limit > 0 ? appUrls.slice(0, limit) : appUrls;

  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel
  });

  const page = await ctx.newPage();

  const map = [];
  const publicSet = new Set();

  for(let i=0; i<targets.length; i++){
    const appUrl = targets[i];
    const seen = new Set();
    const foundHere = new Set();

    const onResponse = async (res) => {
      try{
        const rurl = res.url();
        if(seen.has(rurl)) return;
        seen.add(rurl);

        const len = Number(res.headers()["content-length"] || "0");
        if(len && len > 6000000) return;

        const txt = await res.text().catch(()=> "");
        for(const u of extractPublicUrlsFromText(txt)) foundHere.add(u);
      }catch(e){}
    };

    page.on("response", onResponse);

    try{
      await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(1200);

      const html = await page.content();
      for(const u of extractPublicUrlsFromText(html)) foundHere.add(u);

      // prova meta og:url
      try{
        const og = await page.$eval('meta[property="og:url"]', el => el.getAttribute("content") || "").catch(()=> "");
        for(const u of extractPublicUrlsFromText(og)) foundHere.add(u);
      }catch(e){}

      const foundList = Array.from(foundHere).filter(u => u.includes("www.entrepedia.co"));
      for(const u of foundList) publicSet.add(u);

      map.push({
        idx: i + 1,
        appUrl,
        publicUrl: foundList[0] || null,
        foundCount: foundList.length
      });

      console.log(`[${i+1}/${targets.length}]`, foundList[0] ? "OK" : "MISS");
    }catch(e){
      map.push({ idx: i + 1, appUrl, publicUrl: null, foundCount: 0, error: String(e?.message || e) });
      console.log(`[${i+1}/${targets.length}] ERROR`);
    }finally{
      page.off("response", onResponse);
    }
  }

  const outPath = path.resolve(process.cwd(), outFile);
  const urls = uniq(Array.from(publicSet)).sort();
  fs.writeFileSync(outPath, urls.join("\n") + (urls.length ? "\n" : ""), "utf8");

  fs.writeFileSync(path.resolve(process.cwd(), "public_url_map.json"), JSON.stringify(map, null, 2), "utf8");

  console.log("OK. Salvato:", outPath, "(", urls.length, "url pubblici )");
  console.log("OK. Salvato: public_url_map.json");

  await ctx.close();
})().catch(err => {
  console.error("FATAL:", err?.message || err);
  process.exit(1);
});
