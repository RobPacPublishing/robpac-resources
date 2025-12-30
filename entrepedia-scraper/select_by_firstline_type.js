#!/usr/bin/env node
/**
 * select_by_firstline_type.js
 *
 * Seleziona prodotti dal master APP dedup usando la PRIMA RIGA significativa della descrizione
 * (su Entrepedia spesso indica la tipologia: Prompt Pack, Template, Workbook, ecc.).
 *
 * Output compatibile con build_payhip_payload.js: wrapper { products:[...] } con campi url/title/description.
 *
 * Uso:
 *   node select_by_firstline_type.js --in entrepedia_products_ALL_APP.dedup.json --type "Prompt Packs" --out entrepedia_products_PROMPT.json
 */
const fs = require("fs");
const path = require("path");

function argValue(argv, key, defVal=null){
  const i = argv.indexOf(key);
  return i === -1 ? defVal : (argv[i+1] ?? defVal);
}
function readJson(p){ return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJson(p, obj){ fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8"); }

function getProducts(data){
  if(Array.isArray(data)) return data;
  if(data && Array.isArray(data.products)) return data.products;
  if(data && Array.isArray(data.items)) return data.items;
  return [];
}

function firstMeaningfulLine(desc){
  const lines = String(desc||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  for(const ln of lines){
    if(ln === "ZIP") continue;
    if(/^(add to cart|buy now|checkout|download)\b/i.test(ln)) continue;
    if(/^\$?\d+(\.\d+)?\s*(usd|eur|gbp)?$/i.test(ln)) continue;
    return ln;
  }
  return "";
}

function cleanDescription(desc){
  return String(desc||"")
    .split(/\r?\n/)
    .filter(ln => ln.trim() !== "ZIP")
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function typeRegex(typeName){
  const t = String(typeName||"").toLowerCase().trim();
  if(!t) return null;

  const map = {
    "prompt packs": /\bprompt\s*pack(s)?\b|\bchatgpt\s*prompt(s)?\b|\bprompts?\b/i,
    "templates": /\btemplate(s)?\b|\bcanva\s*template(s)?\b|\bnotion\s*template(s)?\b/i,
    "workbooks": /\bworkbook(s)?\b/i,
    "guides": /\bguide(s)?\b/i,
    "planners": /\bplanner(s)?\b|\btracker(s)?\b|\bjournal(s)?\b/i,
    "checklists": /\bchecklist(s)?\b/i,
    "scripts": /\bscript(s)?\b|\byoutube\s*script(s)?\b|\bpodcast\s*script(s)?\b/i,
    "graphics": /\bgraphics?\b|\bclipart\b|\bicons?\b|\bsvg\b|\bpng\b/i,
  };
  return map[t] || new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

function main(){
  const argv = process.argv.slice(2);
  const inFile = argValue(argv, "--in", "entrepedia_products_ALL_APP.dedup.json");
  const type = argValue(argv, "--type", "");
  const outFile = argValue(argv, "--out", "entrepedia_products_SELECTED.json");

  if(!type){
    console.error('Manca --type (es: --type "Prompt Packs")');
    process.exit(1);
  }

  const rx = typeRegex(type);
  if(!rx){
    console.error("Tipo non valido:", type);
    process.exit(1);
  }

  const data = readJson(path.resolve(process.cwd(), inFile));
  const products = getProducts(data);

  const selected = [];
  for(const p of products){
    const url = p.sourceUrl || p.url || p.link || p.productUrl || "";
    const title = String(p.title || p.name || "").trim();
    const description = cleanDescription(p.description || p.longDescription || p.shortDescription || "");
    const line1 = firstMeaningfulLine(description);
    const fallback = String(p.type || p.inferredType || p.category || "").trim();

    const hay = [line1, fallback, title].filter(Boolean).join(" | ");
    if(rx.test(hay)){
      selected.push({
        url,
        title,
        description,
        mainCategory: type,
        subCategory: ""
      });
    }
  }

  writeJson(path.resolve(process.cwd(), outFile), {
    generatedAt: new Date().toISOString(),
    counts: { selected: selected.length },
    products: selected
  });

  console.log("OK. selected:", selected.length);
  console.log("OUT:", path.resolve(process.cwd(), outFile));
}

try{ main(); }catch(e){
  console.error("FATAL:", e?.message || e);
  process.exit(1);
}
