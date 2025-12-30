#!/usr/bin/env node
/**
 * set_all_prices_to_10.js
 * Imposta price=10 per tutti i prodotti in products.json (senza toccare payhipId/payhipUrl).
 * Crea un backup automatico: products.json.bak-YYYYMMDD-HHMMSS
 *
 * Uso (nella cartella dove c'è products.json):
 *   node set_all_prices_to_10.js
 */
const fs = require("fs");
const path = require("path");

function nowStamp(){
  const d = new Date();
  const pad = (n)=>String(n).padStart(2,"0");
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
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

  let changed = 0;
  for(const p of arr){
    const current = Number(p.price);
    if(!Number.isFinite(current) || current !== 10){
      p.price = 10;
      changed++;
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
  console.log("Prodotti impostati a $10:", changed);
}

main();
