#!/usr/bin/env node
/**
 * fix_prompt_pack_covers.js
 *
 * Scopo:
 * - Per i prodotti "Prompt" in products.json:
 *   1) imposta p.cover = "/covers/<filename>"
 *   2) copia il file immagine da entrepedia-scraper/covers -> ./covers se manca
 *   3) genera SEMPRE un report: missing_prompt_covers.txt (anche se vuoto)
 *
 * Uso (da ROOT repo: F:\robpac-resources):
 *   node fix_prompt_pack_covers.js --entrepedia ./entrepedia-scraper/entrepedia_products_PROMPT.json
 *
 * Opzioni:
 *   --site <path>            default ./products.json
 *   --covers <dir>           default ./covers
 *   --scraper-covers <dir>   default ./entrepedia-scraper/covers
 */
const fs = require("fs");
const path = require("path");

function argValue(argv, key, defVal = null){
  const i = argv.indexOf(key);
  if(i >= 0 && i + 1 < argv.length) return argv[i+1];
  return defVal;
}
function fileExists(p){ try { fs.accessSync(p, fs.constants.F_OK); return true; } catch { return false; } }
function ensureDir(p){ if(!fileExists(p)) fs.mkdirSync(p, {recursive:true}); }
function loadJson(p){ return JSON.parse(fs.readFileSync(p, "utf8")); }
function saveJson(p, obj){ fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8"); }

function normTitle(s){
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[’']/g, "'")
    .trim();
}
function basenameFromAny(v){
  if(!v) return null;
  const s = String(v);
  const base = s.split(/[\\/]/).pop().split("?")[0].split("#")[0];
  if(!base || base.length < 3) return null;
  if(!/\.(png|jpg|jpeg|webp)$/i.test(base)) return null;
  return base;
}
function pickCoverFilename(entItem){
  const keys = [
    "coverLocalPath","coverLocal","coverFile","coverFilename","cover_file",
    "cover","image","imageUrl","coverUrl","thumbnail","thumb","previewImage"
  ];
  for(const k of keys){
    if(entItem && entItem[k]){
      const b = basenameFromAny(entItem[k]);
      if(b) return b;
    }
  }
  if(entItem && entItem.assets){
    for(const k of ["cover","image","thumbnail","thumb"]){
      const b = basenameFromAny(entItem.assets[k]);
      if(b) return b;
    }
  }
  return null;
}
function isPromptProduct(p){
  const fmtRaw = (p.format ?? p.formats ?? p.type ?? p.contentType ?? p.productType ?? "");
  const fmt = Array.isArray(fmtRaw) ? fmtRaw.join(" ") : String(fmtRaw);
  const cat = String(p.category || "");
  return (fmt.toLowerCase().includes("prompt") || cat.toLowerCase().includes("prompt"));
}

function copyIfExists(src, dst){
  try{
    if(fileExists(src) && !fileExists(dst)){
      fs.copyFileSync(src, dst);
      return true;
    }
  }catch{}
  return false;
}
function listImages(dir){
  try{ return fs.readdirSync(dir).filter(f=>/\.(png|jpg|jpeg|webp)$/i.test(f)); }
  catch{ return []; }
}
function fuzzyFindCoverByTitle(images, title){
  const t = normTitle(title);
  const tokens = t.split(" ").filter(x=>x.length>=4).slice(0,6);
  if(tokens.length === 0) return null;
  let best = null, bestScore = 0;
  for(const img of images){
    const f = img.toLowerCase();
    let score = 0;
    for(const tok of tokens) if(f.includes(tok)) score++;
    if(score > bestScore){ bestScore = score; best = img; }
  }
  return bestScore >= 2 ? best : null;
}

function main(){
  const argv = process.argv.slice(2);
  const sitePath = argValue(argv, "--site", "./products.json");
  const entrePath = argValue(argv, "--entrepedia", "./entrepedia-scraper/entrepedia_products_PROMPT.json");
  const coversDir = argValue(argv, "--covers", "./covers");
  const scraperCoversDir = argValue(argv, "--scraper-covers", "./entrepedia-scraper/covers");
  const reportPath = "missing_prompt_covers.txt";

  if(!fileExists(sitePath)){
    console.error("FATAL: products.json non trovato:", sitePath);
    process.exit(1);
  }
  if(!fileExists(entrePath)){
    console.error("FATAL: file Entrepedia prompt non trovato:", entrePath);
    process.exit(1);
  }

  ensureDir(coversDir);

  const site = loadJson(sitePath);
  const siteProducts = Array.isArray(site) ? site : (site.products || []);
  if(!Array.isArray(siteProducts)){
    console.error("FATAL: products.json non contiene un array prodotti (site.products).");
    process.exit(1);
  }

  const ent = loadJson(entrePath);
  const entProducts = Array.isArray(ent) ? ent : (ent.products || []);
  if(!Array.isArray(entProducts)){
    console.error("FATAL: entrepedia_products_PROMPT.json non contiene un array.");
    process.exit(1);
  }

  const byTitle = new Map();
  const byId = new Map();
  for(const e of entProducts){
    const t = normTitle(e.title || e.name);
    const fn = pickCoverFilename(e);
    if(t && fn && !byTitle.has(t)) byTitle.set(t, fn);
    const id = String(e.id || e.uuid || e.productId || e.entrepediaId || "").trim();
    if(id && fn && !byId.has(id)) byId.set(id, fn);
  }

  const imagesRoot = listImages(coversDir);
  const imagesScraper = listImages(scraperCoversDir);

  const stamp = new Date().toISOString().replace(/[:.]/g,"").slice(0,15);
  const bakPath = sitePath.replace(/\.json$/i, "") + `.bak-${stamp}.json`;
  saveJson(bakPath, site);

  let promptCount = 0, updatedCoverField = 0, copied = 0, okFiles = 0, missingFiles = 0;
  const reportLines = [];
  const sampleLines = [];

  for(const p of siteProducts){
    if(!isPromptProduct(p)) continue;
    promptCount++;

    const title = p.title || p.name || "(senza titolo)";
    const tkey = normTitle(title);
    const pid = String(p.entrepediaId || p.sourceId || p.id || "").trim();

    const current = p.cover || p.image || p.thumbnail || "";
    const currentBase = basenameFromAny(current);

    let targetFn = null;

    if(typeof current === "string" && current.startsWith("/covers/")){
      targetFn = current.replace("/covers/","").trim();
    } else {
      if(pid && byId.has(pid)) targetFn = byId.get(pid);
      if(!targetFn && byTitle.has(tkey)) targetFn = byTitle.get(tkey);
      if(!targetFn && currentBase) targetFn = currentBase;
      if(!targetFn){
        const fuzz = fuzzyFindCoverByTitle(imagesRoot, title) || fuzzyFindCoverByTitle(imagesScraper, title);
        if(fuzz) targetFn = fuzz;
      }
    }

    if(!targetFn){
      missingFiles++;
      reportLines.push(`${title} | cover NON determinata`);
      continue;
    }

    const destPath = path.join(coversDir, targetFn);
    const srcPath = path.join(scraperCoversDir, targetFn);

    if(!fileExists(destPath) && fileExists(srcPath)){
      if(copyIfExists(srcPath, destPath)) copied++;
    }

    p.cover = "/covers/" + targetFn;
    updatedCoverField++;

    if(fileExists(destPath)){
      okFiles++;
    } else {
      missingFiles++;
      reportLines.push(`${title} | ${p.cover} (file mancante)`);
    }

    if(sampleLines.length < 10){
      sampleLines.push(`${title} | ${p.cover}`);
    }
  }

  if(Array.isArray(site)){
    saveJson(sitePath, siteProducts);
  } else {
    site.products = siteProducts;
    saveJson(sitePath, site);
  }

  const header = [
    `PROMPT PRODUCTS FOUND: ${promptCount}`,
    `COVER FIELD UPDATED: ${updatedCoverField}`,
    `COPIED IMAGES: ${copied}`,
    `OK FILES: ${okFiles}`,
    `MISSING: ${missingFiles}`,
    "",
    "SAMPLE (first 10):",
    ...sampleLines,
    "",
    "MISSING DETAILS:",
    ...(reportLines.length ? reportLines : ["(none)"]),
    ""
  ].join("\n");
  fs.writeFileSync(reportPath, header, "utf8");

  console.log("OK. Prompt products:", promptCount);
  console.log("OK. Copied images:", copied);
  console.log("OK. Missing:", missingFiles);
  console.log("Report:", reportPath);
  console.log("Backup:", bakPath);

  if(promptCount === 0){
    console.log("WARN: nessun Prompt Pack individuato in products.json (controllare campi format/category).");
  }
}

main();
