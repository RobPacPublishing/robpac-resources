#!/usr/bin/env node
/**
 * build_payhip_payload_v5.js
 * Crea un payload "compatto" per Payhip:
 * - payhip_payload/payhip_products.json  (metadati + percorsi relativi)
 * - payhip_payload/files/<UUID>.zip      (file digitale)
 * - payhip_payload/covers/<UUID>.<ext>   (cover)
 *
 * Uso (da /.../entrepedia-scraper):
 *   node build_payhip_payload_v5.js --in ./entrepedia_products.json --downloads ./downloads --out ../payhip_payload --price 10 --currency USD
 */
const fs = require("fs");
const path = require("path");

const UUID_RE_G_G = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

function argValue(argv, key, defVal=null){
  const i = argv.indexOf(key);
  if(i === -1) return defVal;
  return argv[i+1] ?? defVal;
}
function hasFlag(argv, key){ return argv.includes(key); }

function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function extractUuid(s){
  // IMPORTANT: some Entrepedia APP URLs may contain multiple UUIDs.
  // We must use the LAST one (the product UUID).
  const str = String(s||"");
  const matches = str.match(UUID_RE_G_G);
  if(!matches || !matches.length) return null;
  return matches[matches.length - 1].toLowerCase();
}

function readJson(p){
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

function findFirstZip(dir){
  // Cerca ricorsivamente il primo .zip dentro dir
  if(!fs.existsSync(dir)) return null;
  const stack = [dir];
  while(stack.length){
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch { continue; }
    for(const e of entries){
      const full = path.join(d, e.name);
      if(e.isDirectory()){
        stack.push(full);
      } else if(e.isFile() && e.name.toLowerCase().endsWith(".zip")){
        return full;
      }
    }
  }
  return null;
}

function copyIfDifferent(src, dst){
  ensureDir(path.dirname(dst));
  if(fs.existsSync(dst)){
    // Se stessa dimensione, non ricopiare (veloce)
    try{
      const a = fs.statSync(src).size;
      const b = fs.statSync(dst).size;
      if(a === b) return;
    }catch{}
  }
  fs.copyFileSync(src, dst);
}

function main(){
  const argv = process.argv.slice(2);
  const inPath = argValue(argv, "--in");
  const downloadsDir = argValue(argv, "--downloads", "./downloads");
  const outDir = argValue(argv, "--out", "../payhip_payload");
  const price = Number(argValue(argv, "--price", "10"));
  const currency = String(argValue(argv, "--currency", "USD")).toUpperCase();

  if(!inPath){
    console.error("FATAL: manca --in");
    process.exit(1);
  }

  const inAbs = path.resolve(process.cwd(), inPath);
  const downloadsAbs = path.resolve(process.cwd(), downloadsDir);
  const outAbs = path.resolve(process.cwd(), outDir);
  const filesAbs = path.join(outAbs, "files");
  const coversAbs = path.join(outAbs, "covers");
  ensureDir(outAbs); ensureDir(filesAbs); ensureDir(coversAbs);

  const rootAbs = path.resolve(process.cwd(), ".."); // repo root, se lo script è in entrepedia-scraper

  let data = readJson(inAbs);
  let products = [];
  if(Array.isArray(data)) products = data;
  else if(data && Array.isArray(data.products)) products = data.products;
  else if(data && Array.isArray(data.items)) products = data.items;
  else products = [];

  const outItems = [];
  let built = 0, missingFile = 0, missingCover = 0;

  for(const p of products){
    const url = p.url || p.productUrl || p.link || "";
    const id = extractUuid(url) || extractUuid(p.id || p.uuid || "");
    if(!id) continue;

    const title = String(p.title || p.name || "").trim();
    const description = String(p.description || p.longDescription || p.shortDescription || "").trim();
    const mainCategory = String(p.mainCategory || p.category || "").trim();
    const subCategory = String(p.subCategory || "").trim();

    // FILE ZIP
    let zipSrc = null;

    // 1) se già esiste in payhip_payload/files/<id>.zip
    const zipAlready = path.join(filesAbs, `${id}.zip`);
    if(fs.existsSync(zipAlready)) zipSrc = zipAlready;

    // 2) altrimenti cerca in downloads/<id>/**
    if(!zipSrc){
      const perProductDir = path.join(downloadsAbs, id);
      zipSrc = findFirstZip(perProductDir);
    }

    // 3) fallback: cerca in downloads/**/<id>*.zip (ultimo tentativo)
    if(!zipSrc){
      // scan leggero: solo livello 2 (uuid/cartella) per non esplodere
      try{
        const top = fs.readdirSync(downloadsAbs, { withFileTypes: true }).filter(e=>e.isDirectory());
        for(const e of top){
          const maybe = path.join(downloadsAbs, e.name);
          const z = findFirstZip(maybe);
          if(z && z.toLowerCase().includes(id)) { zipSrc = z; break; }
        }
      }catch{}
    }

    if(!zipSrc){
      missingFile++;
      continue;
    }

    const zipDstRel = `files/${id}.zip`;
    const zipDstAbs = path.join(outAbs, zipDstRel);
    if(path.resolve(zipSrc) !== path.resolve(zipDstAbs)){
      copyIfDifferent(zipSrc, zipDstAbs);
    }

    // COVER
    let coverDstRel = null;
    const coverPath = p.coverPath || p.cover || p.coverLocal || null;
    if(coverPath){
      const coverSrcAbs = path.isAbsolute(coverPath) ? coverPath : path.resolve(rootAbs, coverPath);
      if(fs.existsSync(coverSrcAbs)){
        const ext = path.extname(coverSrcAbs) || ".jpg";
        coverDstRel = `covers/${id}${ext.toLowerCase()}`;
        const coverDstAbs = path.join(outAbs, coverDstRel);
        if(path.resolve(coverSrcAbs) !== path.resolve(coverDstAbs)){
          copyIfDifferent(coverSrcAbs, coverDstAbs);
        }
      }else{
        missingCover++;
      }
    }else{
      missingCover++;
    }

    outItems.push({
      id,
      title,
      description,
      price,
      currency,
      mainCategory,
      subCategory,
      productFile: zipDstRel,
      coverFile: coverDstRel
    });
    built++;
  }

  const outJson = {
    generatedAt: new Date().toISOString(),
    price,
    currency,
    counts: { source: products.length, built, missingFile, missingCover },
    products: outItems
  };

  const outPath = path.join(outAbs, "payhip_products.json");
  fs.writeFileSync(outPath, JSON.stringify(outJson, null, 2), "utf8");

  console.log("OK build:", built);
  console.log("MISSING_FILE:", missingFile);
  console.log("MISSING_COVER:", missingCover);
  console.log("OUT:", outPath);
  console.log("FILES:", filesAbs);
  console.log("COVERS:", coversAbs);
}

try { main(); } catch (e) {
  console.error("FATAL:", e && e.message ? e.message : e);
  process.exit(1);
}
