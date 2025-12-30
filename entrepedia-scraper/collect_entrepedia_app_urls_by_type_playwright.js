#!/usr/bin/env node
/**
 * collect_entrepedia_app_urls_by_type_playwright_V3.js  (assistita + affidabile)
 *
 * Vuoi applicare la STESSA regola degli eBook: prima filtri per tipologia, poi scrapi solo quelli.
 * Questa V3 evita selettori fragili: apre la Libreria APP, TU applichi il filtro (es. Prompt Packs),
 * premi ENTER nel terminale, e lo script raccoglie TUTTI i link prodotto (scroll + load more).
 *
 * Uso:
 *   node collect_entrepedia_app_urls_by_type_playwright_V3.js --out urls_prompt.txt --channel chrome
 *
 * Opzioni:
 *   --out <file>        output (default: urls_out.txt)
 *   --channel <name>    chrome | msedge | chromium (default: chrome)
 *   --user-data <dir>   profilo Playwright (default: .pw-user-data-chrome)
 *   --max <n>           cap sicurezza (default: 5000)
 */
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { chromium } = require("playwright");

function argValue(argv, key, defVal=null){
  const i = argv.indexOf(key);
  return i === -1 ? defVal : (argv[i+1] ?? defVal);
}

function normalize(u){
  try{
    const url = /^https?:\/\//i.test(u) ? new URL(u) : new URL(u, "https://app.entrepedia.co");
    url.search = "";
    url.hash = "";
    return url.toString();
  }catch{
    return String(u||"").trim();
  }
}

function waitEnter(prompt){
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

async function autoScrollCollect(page, max=5000){
  const seen = new Set();
  let sameRounds = 0;

  while(true){
    const hrefs = await page.$$eval("a[href]", els => els.map(a => a.getAttribute("href") || "").filter(Boolean));
    for(const h of hrefs){
      const hu = normalize(h);
      if(/\/library\/product\//i.test(hu)){
        seen.add(hu);
      }
    }
    if(seen.size >= max) break;

    const before = seen.size;

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);

    // prova a cliccare un eventuale "Load more"
    const clicked = await page.evaluate(() => {
      const texts = ["Load more", "Show more", "More", "Load More"];
      const btns = Array.from(document.querySelectorAll("button, a")).filter(el => {
        const t = (el.innerText || "").trim();
        return texts.includes(t);
      });
      if(btns.length){
        btns[0].click();
        return true;
      }
      return false;
    });
    if(clicked) await page.waitForTimeout(1500);

    const after = seen.size;
    if(after === before) sameRounds++;
    else sameRounds = 0;

    if(sameRounds >= 6) break;
  }

  return Array.from(seen);
}

async function main(){
  const argv = process.argv.slice(2);
  const outFile = argValue(argv, "--out", "urls_out.txt");
  const channel = argValue(argv, "--channel", "chrome");
  const userData = argValue(argv, "--user-data", ".pw-user-data-chrome");
  const max = Number(argValue(argv, "--max", "5000"));

  const userDataDir = path.resolve(process.cwd(), userData);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"]
  });

  const page = await context.newPage();
  console.log("OPEN: https://app.entrepedia.co/library");
  await page.goto("https://app.entrepedia.co/library", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  console.log("");
  console.log("AZIONE MANUALE:");
  console.log("1) Se non sei loggato, fai login.");
  console.log("2) Applica il filtro della tipologia (es. 'Prompt Packs').");
  console.log("3) Verifica che la lista mostri SOLO quella tipologia.");
  console.log("");

  await waitEnter("Quando il filtro è applicato e vedi la lista corretta, premi ENTER qui... ");

  const links = await autoScrollCollect(page, max);

  fs.writeFileSync(path.resolve(process.cwd(), outFile), links.join("\n") + (links.length ? "\n" : ""), "utf8");
  console.log(`OK. Salvato: ${path.resolve(process.cwd(), outFile)} ( ${links.length} link )`);

  await context.close();
}

main().catch(err => {
  console.error("FATAL:", err?.message || err);
  process.exit(1);
});
