#!/usr/bin/env node
/**
 * select_from_app_master.js
 *
 * Prende il master dedup (entrepedia_products_ALL_APP.dedup.json) e crea un subset per tipologia,
 * pronto da passare a build_payhip_payload.js.
 *
 * USO:
 *   node select_from_app_master.js --in entrepedia_products_ALL_APP.dedup.json --type "Prompt Packs" --out entrepedia_products_SELECTED.json
 *
 * NOTE:
 * - --type è case-insensitive. Se omesso, crea "NON_BOOK" (tutto tranne book/eBook, basandosi su type).
 */
const fs = require("fs");
const path = require("path");

function argValue(argv, key, defVal=null){
  const i = argv.indexOf(key);
  return i === -1 ? defVal : (argv[i+1] ?? defVal);
}
function readJson(p){
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeJson(p, obj){
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

function isBookType(t){
  const s = String(t||"").toLowerCase();
  return s.includes("book") || s.includes("ebook");
}

function main(){
  const argv = process.argv.slice(2);
  const inFile = argValue(argv, "--in", "entrepedia_products_ALL_APP.dedup.json");
  const type = argValue(argv, "--type", "");
  const outFile = argValue(argv, "--out", "entrepedia_products_SELECTED.json");

  const inAbs = path.resolve(process.cwd(), inFile);
  if(!fs.existsSync(inAbs)){
    console.error("FATAL: input mancante:", inAbs);
    process.exit(1);
  }

  const master = readJson(inAbs);
  const items = master.products || [];

  let picked = [];
  if(type){
    const rx = new RegExp(type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    picked = items.filter(p => rx.test(String(p.type||"")));
  }else{
    picked = items.filter(p => !isBookType(p.type));
  }

  const out = {
    generatedAt: new Date().toISOString(),
    filterType: type || "NON_BOOK",
    count: picked.length,
    products: picked.map(p => ({
      url: p.sourceUrl,
      title: p.title,
      description: p.description,
      category: p.type || ""
    }))
  };

  writeJson(path.resolve(process.cwd(), outFile), out);
  console.log("OK. selected:", out.count);
  console.log("OUT:", path.resolve(process.cwd(), outFile));
}

try{ main(); }catch(e){
  console.error("FATAL:", e?.message || e);
  process.exit(1);
}
