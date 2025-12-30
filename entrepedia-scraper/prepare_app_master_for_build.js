#!/usr/bin/env node
/**
 * prepare_app_master_for_build.js  (V4 diagnostic + URL-based ID)
 *
 * Se anche V3 collassa a ~30-40, vuol dire che gli ID estratti NON sono quelli dei prodotti.
 * V4 rende l'ID robusto e aggiunge diagnostica.
 *
 * ID:
 *   1) token dopo /library/product/  (può NON essere un UUID: può essere uno slug o un id interno)
 *   2) fallback: hash dell'URL normalizzato (senza query/hash)
 *
 * Dedup:
 *   - SOLO per ID (non per titolo) per evitare falsi "dup"
 *
 * USO:
 *   node prepare_app_master_for_build.js --in entrepedia_products_ALL_APP_V2.json
 *
 * Output:
 *   - entrepedia_products_ALL_APP.dedup.json
 *   - entrepedia_products_FOR_BUILD.json
 *   - types_counts.csv
 *   - debug_prepare_v4_dups.txt   (se ci sono molti duplicati, mostra i top)
 */
const fs = require("fs");
const path = require("path");

function argValue(argv, key, defVal=null){
  const i = argv.indexOf(key);
  return i === -1 ? defVal : (argv[i+1] ?? defVal);
}
function readJson(p){ return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJson(p, obj){ fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8"); }

function normalizeUrl(u){
  try{
    const url = /^https?:\/\//i.test(u) ? new URL(u) : new URL(u, "https://app.entrepedia.co");
    url.search = "";
    url.hash = "";
    return url.toString();
  }catch{
    return String(u || "").trim();
  }
}

function tokenFromAppUrl(u){
  const nu = normalizeUrl(u);
  const m = nu.match(/\/library\/product\/([^\/\?\#]+)/i);
  return m ? String(m[1]).trim().toLowerCase() : "";
}

// FNV-1a 32bit
function fnv1a(str){
  let h = 0x811c9dc5;
  const s = String(str||"");
  for(let i=0;i<s.length;i++){
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}

function stripZipLine(desc){
  const lines = String(desc||"").split(/\r?\n/);
  const kept = [];
  for(const ln of lines){
    if(ln.trim() === "ZIP") continue;
    kept.push(ln);
  }
  return kept.join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

function loadExistingIdsFromSite(repoRootAbs){
  const p = path.join(repoRootAbs, "products.json");
  const ids = new Set();
  if(!fs.existsSync(p)) return ids;
  try{
    const data = readJson(p);
    if(Array.isArray(data)){
      for(const it of data){
        const url = it.payhipUrl || it.url || it.sourceUrl || it.entrepediaUrl || "";
        const t = tokenFromAppUrl(url);
        if(t) ids.add(t);
        if(it.id) ids.add(String(it.id).toLowerCase());
      }
    }
  }catch{}
  return ids;
}

function main(){
  const argv = process.argv.slice(2);
  const inFile = argValue(argv, "--in", "entrepedia_products_ALL_APP_V2.json");
  const outFile = argValue(argv, "--out", "entrepedia_products_ALL_APP.dedup.json");
  const outBuildFile = argValue(argv, "--out-build", "entrepedia_products_FOR_BUILD.json");

  const inAbs = path.resolve(process.cwd(), inFile);
  if(!fs.existsSync(inAbs)){
    console.error("FATAL: input mancante:", inAbs);
    process.exit(1);
  }

  const repoRootAbs = path.resolve(process.cwd(), "..");
  const existingIds = loadExistingIdsFromSite(repoRootAbs);

  const raw = readJson(inAbs);
  const items = Array.isArray(raw) ? raw : (raw.products || raw.items || []);
  const urlCount = items.length;

  // diagnostica: quante URL uniche?
  const urlsNorm = items.map(it => normalizeUrl(it.sourceUrl || it.url || it.link || ""));
  const uniqueUrlCount = new Set(urlsNorm.filter(Boolean)).size;

  const byId = new Map();
  const dupStats = new Map();

  let total = 0, kept = 0, droppedExisting = 0, droppedNoId = 0, droppedDup = 0, emptyToken = 0;

  for(const it of items){
    total++;
    const srcRaw = it.sourceUrl || it.url || it.link || "";
    const src = normalizeUrl(srcRaw);
    const tok = tokenFromAppUrl(src);
    if(!tok) emptyToken++;

    let id = tok ? tok : ("u_" + fnv1a(src));
    if(!id || id === "u_00000000"){ droppedNoId++; continue; }

    if(existingIds.has(id)){
      droppedExisting++;
      continue;
    }

    if(byId.has(id)){
      droppedDup++;
      dupStats.set(id, (dupStats.get(id)||0)+1);
      continue;
    }

    byId.set(id, {
      id,
      sourceUrl: src,
      title: String(it.title || "").trim(),
      description: stripZipLine(it.description || ""),
      type: String(it.type || it.inferredType || it.category || "").trim()
    });
    kept++;
  }

  const dedup = Array.from(byId.values());

  // types counts
  const counts = new Map();
  for(const p of dedup){
    const k = p.type ? p.type : "(missing)";
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const csvLines = ["type,count"];
  for(const [k,v] of Array.from(counts.entries()).sort((a,b)=>b[1]-a[1])){
    const safe = '"' + String(k).replace(/"/g,'""') + '"';
    csvLines.push(`${safe},${v}`);
  }
  fs.writeFileSync(path.resolve(process.cwd(), "types_counts.csv"), csvLines.join("\n") + "\n", "utf8");

  // build file
  const buildProducts = dedup.map(p => ({
    url: p.sourceUrl,
    title: p.title,
    description: p.description,
    category: p.type || ""
  }));

  writeJson(path.resolve(process.cwd(), outFile), {
    generatedAt: new Date().toISOString(),
    totalInput: total,
    diagnostics: { urlCount, uniqueUrlCount, emptyToken },
    kept,
    dropped: { droppedExisting, droppedNoId, droppedDup },
    products: dedup
  });

  writeJson(path.resolve(process.cwd(), outBuildFile), {
    generatedAt: new Date().toISOString(),
    products: buildProducts
  });

  // dup debug
  const top = Array.from(dupStats.entries()).sort((a,b)=>b[1]-a[1]).slice(0, 25);
  const dbgLines = [
    `total=${total}`,
    `uniqueUrlCount=${uniqueUrlCount}`,
    `emptyToken=${emptyToken}`,
    `droppedDup=${droppedDup}`,
    "",
    "topDuplicateIds (id -> extra_occurrences):",
    ...top.map(([id,c]) => `${id}\t${c}`)
  ];
  fs.writeFileSync(path.resolve(process.cwd(), "debug_prepare_v4_dups.txt"), dbgLines.join("\n") + "\n", "utf8");

  console.log("OK. total:", total);
  console.log("DIAG. uniqueUrlCount:", uniqueUrlCount, "emptyToken:", emptyToken);
  console.log("OK. kept:", kept);
  console.log("DROPPED existing(site):", droppedExisting);
  console.log("DROPPED no-id:", droppedNoId);
  console.log("DROPPED dup:", droppedDup);
  console.log("OUT master:", path.resolve(process.cwd(), outFile));
  console.log("OUT build:", path.resolve(process.cwd(), outBuildFile));
  console.log("OUT types:", path.resolve(process.cwd(), "types_counts.csv"));
  console.log("OUT debug:", path.resolve(process.cwd(), "debug_prepare_v4_dups.txt"));
}

try{ main(); }catch(e){
  console.error("FATAL:", e?.message || e);
  process.exit(1);
}
