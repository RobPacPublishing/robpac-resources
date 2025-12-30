#!/usr/bin/env node
/**
 * collect_entrepedia_app_urls_by_type_playwright.js
 *
 * Colleziona gli URL prodotto dall'app Entrepedia (app.entrepedia.co) per una tipologia (es. "Prompt Packs").
 * Salva un file di URL (uno per riga) tipo:
 *   https://app.entrepedia.co/library/product/<UUID>
 *
 * USO:
 *   node collect_entrepedia_app_urls_by_type_playwright.js --type "Prompt Packs" --out urls_prompt.txt --channel chrome
 *
 * Note:
 * - Apre un browser NON headless. Se serve, fai login e poi lascia proseguire.
 * - Crea anche debug_app_page.html + debug_app_page.png
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

async function clickIfVisible(locator){
  try{
    if(await locator.isVisible({ timeout: 1500 }).catch(()=>false)){
      await locator.click({ timeout: 2000 }).catch(()=>{});
      return true;
    }
  }catch(e){}
  return false;
}

(async () => {
  const argv = process.argv.slice(2);
  const type = argValue(argv, "--type", null);          // es: "Prompt Packs"
  const out = argValue(argv, "--out", "urls.txt");
  const channel = argValue(argv, "--channel", "chrome");
  const maxScrolls = Number(argValue(argv, "--max-scrolls", "120"));
  const waitMs = Number(argValue(argv, "--wait", "900"));

  if(!type){
    console.error("Manca --type (es: --type "Prompt Packs")");
    process.exit(1);
  }

  const url = "https://app.entrepedia.co/library";

  const browser = await chromium.launch({ headless: false, channel });
  const page = await browser.newPage();

  console.log("OPEN:", url);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);

  // Se sei su sign-in, fai login manualmente: aspettiamo che compaia qualcosa della library
  // (non blocca se sei già loggato)
  try{
    await page.waitForSelector('text=/All Products/i', { timeout: 20000 });
  }catch(e){
    console.log("Se vedi la pagina di login, effettua login ora (hai ~60s)...");
    try{
      await page.waitForSelector('text=/All Products/i', { timeout: 60000 });
    }catch(_){}
  }

  // Click "All Products" (per ripartire da lista completa)
  await clickIfVisible(page.getByRole("link", { name: /All Products/i }).first());
  await clickIfVisible(page.getByRole("button", { name: /All Products/i }).first());
  await page.waitForTimeout(1200);

  // Applica filtro tipologia cercando testo in vari modi
  const rx = new RegExp(type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

  // Prova come chip/button/link
  const candidates = [
    page.getByRole("button", { name: rx }).first(),
    page.getByRole("link", { name: rx }).first(),
    page.locator(`text=/${type}/i`).first(),
  ];

  let clicked = false;
  for(const c of candidates){
    if(await clickIfVisible(c)){
      clicked = true;
      break;
    }
  }
  if(!clicked){
    console.log("WARN: filtro non cliccato automaticamente. Se vedi i filtri, clicca tu:", type);
    // breve attesa per permettere click manuale
    await page.waitForTimeout(7000);
  }else{
    await page.waitForTimeout(1500);
  }

  // Scroll per caricare tutti i prodotti
  let prevCount = 0;
  for(let i=0; i<maxScrolls; i++){
    // prova anche eventuale pulsante Load more
    const loadBtn = page.locator("text=/load more/i").first();
    if(await loadBtn.isVisible().catch(()=>false)){
      await loadBtn.click().catch(()=>{});
      await page.waitForTimeout(waitMs);
    }else{
      await page.mouse.wheel(0, 2500);
      await page.waitForTimeout(waitMs);
    }

    // conta link prodotti presenti
    const count = await page.locator('a[href*="/library/product/"]').count().catch(()=>0);
    if(count > prevCount){
      prevCount = count;
    }else if(i > 8){
      // se non cresce più per un po', usciamo
      // (lasciamo qualche scroll iniziale per stabilizzare)
      break;
    }
  }

  // Estrai href
  const hrefs = await page.$$eval('a[href*="/library/product/"]', as =>
    as.map(a => a.getAttribute("href") || "").filter(Boolean)
  );

  const urls = uniq(hrefs.map(ensureAbsApp)).sort();
  const outPath = path.resolve(process.cwd(), out);
  fs.writeFileSync(outPath, urls.join("\n") + (urls.length ? "\n" : ""), "utf8");

  // Debug
  const html = await page.content();
  fs.writeFileSync(path.resolve(process.cwd(), "debug_app_page.html"), html, "utf8");
  await page.screenshot({ path: path.resolve(process.cwd(), "debug_app_page.png"), fullPage: true }).catch(()=>{});

  console.log("OK. Salvato:", outPath, "(", urls.length, "link )");
  console.log("DEBUG: debug_app_page.html + debug_app_page.png");

  await browser.close();
})().catch(err => {
  console.error("FATAL:", err?.message || err);
  process.exit(1);
});
