#!/usr/bin/env node
/**
 * remove_zip_line_in_descriptions.js
 * Rimuove automaticamente la riga "ZIP" quando è una riga isolata nelle descrizioni:
 * (riga vuota) + "ZIP" + (riga vuota)
 *
 * - Modifica products.json in-place
 * - Crea backup: products.json.bak-YYYYMMDD-HHMMSS
 *
 * Uso:
 *   node remove_zip_line_in_descriptions.js
 */
const fs = require("fs");
const path = require("path");

function nowStamp(){
  const d = new Date();
  const pad = (n)=>String(n).padStart(2,"0");
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function normalizeNewlines(s){
  return String(s || "").replace(/\r\n/g, "\n");
}

function main(){
  const productsPath = path.join(process.cwd(), "products.json");
  if(!fs.existsSync(productsPath)){
    console.error("FATAL: products.json non trovato nella cartella corrente:", process.cwd());
    process.exit(1);
  }

  const raw = fs.readFileSync(productsPath, "utf8");
  let data = JSON.parse(raw);

  // Supporta sia array diretto che oggetto {products:[...]}
  let arr = Array.isArray(data) ? data : (Array.isArray(data.products) ? data.products : null);
  if(!arr){
    console.error("FATAL: products.json non è un array e non contiene data.products[]");
    process.exit(1);
  }

  // pattern: blank line + ZIP + blank line (con eventuali spazi)
  const re = /(\n)\s*(\n)ZIP(\n)\s*(\n)/g;

  let touched = 0;
  let removed = 0;

  for(const p of arr){
    if(!p || typeof p.description !== "string") continue;
    const before = normalizeNewlines(p.description);
    if(!re.test(before)) continue;

    // reset regex state per sicurezza
    re.lastIndex = 0;

    const after = before.replace(re, "\n\n"); // mantiene la separazione in modo pulito
    if(after !== before){
      p.description = after.replace(/\n{3,}/g, "\n\n"); // evita troppe righe vuote
      touched++;
      // conta quante volte
      const count = (before.match(re) || []).length;
      removed += count;
    }
  }

  const bak = productsPath + `.bak-` + nowStamp();
  fs.copyFileSync(productsPath, bak);

  // Rimonta nella struttura originale
  if(Array.isArray(data)) data = arr;
  else data.products = arr;

  fs.writeFileSync(productsPath, JSON.stringify(data, null, 2), "utf8");

  console.log("OK. Aggiornato products.json");
  console.log("Backup:", path.basename(bak));
  console.log("Prodotti toccati:", touched);
  console.log("Occorrenze 'ZIP' rimosse:", removed);
}

main();
