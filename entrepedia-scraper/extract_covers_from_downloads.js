#!/usr/bin/env node
/**
 * Estrae / normalizza le cover dai download di Entrepedia e le copia in ../covers
 * usando come nome file la coverPath già presente in entrepedia_products.json.
 *
 * Default:
 * - input JSON: ./entrepedia_products.json (nella cartella entrepedia-scraper)
 * - downloads:  ./downloads/<uuid>/
 * - output:     ../covers/
 */
const fs = require("fs");
const path = require("path");

function parseArgs(argv){
  const a={ json:"./entrepedia_products.json", downloads:"./downloads", out:"../covers" };
  for(let i=2;i<argv.length;i++){
    const k=argv[i];
    if(k==="--json") a.json=argv[++i];
    else if(k==="--downloads") a.downloads=argv[++i];
    else if(k==="--out") a.out=argv[++i];
  }
  return a;
}
function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true}); }
function readJson(p){ return JSON.parse(fs.readFileSync(p,"utf8")); }

function pickBestImage(dir){
  if(!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f=>/\.(jpg|jpeg|png|webp)$/i.test(f));
  if(files.length===0) return null;

  const scored = files.map(f=>{
    const full = path.join(dir,f);
    const st = fs.statSync(full);
    const name = f.toLowerCase();
    let score = st.size;
    if(name.includes("book cover")) score += 10_000_000;
    else if(name.includes("cover")) score += 6_000_000;
    else if(name.includes("artwork")) score += 3_000_000;
    return { f, full, score };
  }).sort((a,b)=>b.score-a.score);

  return scored[0].full;
}

function main(){
  const args=parseArgs(process.argv);
  const jsonPath=path.resolve(process.cwd(), args.json);
  const downloadsDir=path.resolve(process.cwd(), args.downloads);
  const outDir=path.resolve(process.cwd(), args.out);

  if(!fs.existsSync(jsonPath)){
    console.error("FATAL json not found:", jsonPath);
    process.exit(1);
  }
  ensureDir(outDir);

  const arr=readJson(jsonPath);
  let ok=0, miss=0;

  for(const p of arr){
    const uuid=p.id || p.uuid;
    const coverPath=p.coverPath || "";
    if(!uuid || !coverPath){ miss++; continue; }

    const targetName = path.basename(coverPath);
    const targetFull = path.join(outDir, targetName);

    // se già esiste, non toccare
    if(fs.existsSync(targetFull)){ ok++; continue; }

    const srcDir = path.join(downloadsDir, uuid);
    const best = pickBestImage(srcDir);
    if(!best){ miss++; continue; }

    fs.copyFileSync(best, targetFull);
    ok++;
  }

  console.log("COVERS_COPIED_OK", ok);
  console.log("COVERS_MISSING", miss);
  console.log("OUT_DIR", outDir);
}

main();
