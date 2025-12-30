const fs = require('fs');

const URLS = 'entrepedia-scraper/urls.txt';
const OUT  = 'entrepedia-scraper/entrepedia_products.json';
const MISSING = 'entrepedia-scraper/urls_missing.txt';

const uuidFromUrlRe = /\/library\/product\/([0-9a-fA-F-]{36})/;

function readJson(p){
  const raw = fs.readFileSync(p,'utf8').trim();
  if(!raw) return null;
  return JSON.parse(raw);
}

function getId(x){
  if(!x || typeof x !== 'object') return null;
  const direct = x.id || x.uuid || x.productId || x.product_id || x._id;
  if(direct) return String(direct).toLowerCase();
  const u = x.url || x.link || x.href || x.permalink;
  if(typeof u === 'string'){
    const m = u.match(uuidFromUrlRe);
    if(m) return m[1].toLowerCase();
  }
  return null;
}

function extractProductsAny(json){
  if(!json) return [];
  if(Array.isArray(json)) return json;

  if(typeof json === 'object'){
    // chiavi tipiche
    for(const k of ['products','items','data','results','list','rows']){
      if(Array.isArray(json[k])) return json[k];
    }

    // se è una mappa {uuid: productObj} o {something: productObj}
    const vals = Object.values(json);
    if(vals.length && vals.some(v => v && typeof v === 'object')){
      return vals;
    }
  }

  return [];
}

if(!fs.existsSync(URLS)) { console.log('URLS_NOT_FOUND', URLS); process.exit(1); }
if(!fs.existsSync(OUT))  { console.log('OUT_NOT_FOUND', OUT); process.exit(1); }

const urlsLines = fs.readFileSync(URLS,'utf8')
  .split(/\r?\n/)
  .map(s=>s.trim())
  .filter(s=>s && !s.startsWith('#'));

const urlMap = new Map();
for(const s of urlsLines){
  const m = s.match(uuidFromUrlRe);
  if(!m) continue;
  const id = m[1].toLowerCase();
  if(!urlMap.has(id)) urlMap.set(id, `https://app.entrepedia.co/library/product/${id}`);
}

let outJson = null;
try { outJson = readJson(OUT); }
catch(e){ console.log('OUT_PARSE_ERROR', e.message); process.exit(1); }

const arr = extractProductsAny(outJson);
const outSet = new Set();
for(const x of arr){
  const id = getId(x);
  if(id) outSet.add(id);
}

// fallback: se non ho id nei valori ma il JSON è una mappa, usa le chiavi come id
if(outSet.size === 0 && outJson && typeof outJson === 'object' && !Array.isArray(outJson)){
  for(const k of Object.keys(outJson)){
    const m = String(k).match(/^[0-9a-fA-F-]{36}$/);
    if(m) outSet.add(String(k).toLowerCase());
  }
}

const missing = [];
for(const [id, url] of urlMap.entries()){
  if(!outSet.has(id)) missing.push(url);
}
missing.sort();
fs.writeFileSync(MISSING, missing.join('\n') + (missing.length ? '\n' : ''));

console.log('URL_UNIQUE_IN_URLS', urlMap.size);
console.log('SCRAPED_OUT', outSet.size);
console.log('MISSING', missing.length);
console.log('OUT_PATH', OUT);
console.log('MISSING_FILE', MISSING);
