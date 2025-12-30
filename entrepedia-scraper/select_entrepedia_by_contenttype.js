#!/usr/bin/env node
/**
 * select_entrepedia_by_contenttype.js
 *
 * Estrae prodotti da un JSON Entrepedia (array) filtrando per contentType e/o prima riga descrizione.
 *
 * Esempio:
 *   node select_entrepedia_by_contenttype.js --in entrepedia_products_ALL_APP_V2.json --match "Prompt" --out entrepedia_products_PROMPT.json
 *
 * Note:
 * - match è case-insensitive
 * - controlla in ordine: contentType, meta/contentType (se presente), prima riga di description/shortDescription
 */
const fs = require("fs");
const path = require("path");

function argValue(argv, name, def=null){
  const i = argv.indexOf(name);
  if(i === -1) return def;
  return argv[i+1] ?? def;
}
function hasFlag(argv, name){ return argv.includes(name); }

const argv = process.argv.slice(2);
const inPath = argValue(argv, "--in");
const outPath = argValue(argv, "--out");
const matchRaw = argValue(argv, "--match");
if(!inPath || !outPath || !matchRaw){
  console.error('USO: node select_entrepedia_by_contenttype.js --in <file.json> --match "Prompt" --out <file.json>');
  process.exit(1);
}
const rx = new RegExp(matchRaw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

function firstLine(s){
  if(!s || typeof s !== "string") return "";
  const t = s.replace(/\r/g, "").trim();
  if(!t) return "";
  return t.split("\n")[0].trim();
}

let arr;
try{
  arr = JSON.parse(fs.readFileSync(inPath, "utf8"));
  if(!Array.isArray(arr)) throw new Error("Input non è un array JSON");
}catch(e){
  console.error("ERRORE lettura JSON:", e.message);
  process.exit(1);
}

const selected = [];
for(const p of arr){
  const ct = (p && (p.contentType || (p.meta && p.meta.contentType) || (p.details && p.details.contentType) || "")) + "";
  const l1 = firstLine(p.description) || firstLine(p.shortDescription) || "";
  const ok = rx.test(ct) || rx.test(l1);
  if(ok) selected.push(p);
}

fs.writeFileSync(outPath, JSON.stringify(selected, null, 2), "utf8");
console.log("OK. total:", arr.length);
console.log("OK. selected:", selected.length);
console.log("OUT:", path.resolve(outPath));
