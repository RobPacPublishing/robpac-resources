#!/usr/bin/env node
/**
 * merge_entrepedia_into_products.js
 *
 * Unisce un file Entrepedia (array) dentro il products.json del sito (array),
 * evitando duplicati e (se disponibile) applicando payhipId/payhipUrl da payhip_links.json.
 *
 * Esempio (da /f/robpac-resources):
 *   node merge_entrepedia_into_products.js --entrepedia ./entrepedia-scraper/entrepedia_products_PROMPT.json --site ./products.json --payhip ./payhip_links_merged.json --default-price 10
 */
const fs = require("fs");
const path = require("path");

function argValue(argv, name, def=null){
  const i = argv.indexOf(name);
  if(i === -1) return def;
  return argv[i+1] ?? def;
}

const argv = process.argv.slice(2);
const entrepediaPath = argValue(argv, "--entrepedia");
const sitePath = argValue(argv, "--site", "products.json");
const payhipPath = argValue(argv, "--payhip", "payhip_links_merged.json");
const defaultPrice = Number(argValue(argv, "--default-price", "10"));

if(!entrepediaPath){
  console.error('USO: node merge_entrepedia_into_products.js --entrepedia <entrepedia.json> [--site products.json] [--payhip payhip_links_merged.json] [--default-price 10]');
  process.exit(1);
}

function readJson(p){
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function safeBasename(p){
  if(!p || typeof p !== "string") return "";
  return path.basename(p.replace(/\\/g,"/"));
}

function inferFormat(p){
  const ct = ((p.contentType || (p.meta && p.meta.contentType) || "") + "").toLowerCase();
  const l1 = ((p.shortDescription || p.description || "") + "").replace(/\r/g,"").split("\n")[0].toLowerCase();

  const s = ct + " " + l1;
  if(s.includes("prompt")) return "prompt";
  if(s.includes("template")) return "template";
  if(s.includes("workbook")) return "workbook";
  if(s.includes("checklist")) return "checklist";
  if(s.includes("audio")) return "audio";
  if(s.includes("video")) return "video";
  if(s.includes("guide")) return "guide";
  return "book";
}

function shortDesc(p){
  const s = (p.shortDescription || p.description || "").toString().replace(/\r/g,"").trim();
  if(!s) return "";
  // Se shortDescription già breve, usa quella; altrimenti tronca la description.
  const one = s.split("\n\n")[0].trim();
  const t = one.length <= 220 ? one : (one.slice(0, 217).trim() + "...");
  return t;
}

function makeIdFromTitle(title){
  return "entrepedia__" + String(title || "").trim();
}

let site = [];
try{
  site = readJson(sitePath);
  if(!Array.isArray(site)) throw new Error("products.json non è un array");
}catch(e){
  console.error("ERRORE lettura site:", e.message);
  process.exit(1);
}

let entrepedia = [];
try{
  entrepedia = readJson(entrepediaPath);
  if(!Array.isArray(entrepedia)) throw new Error("entrepedia input non è un array");
}catch(e){
  console.error("ERRORE lettura entrepedia:", e.message);
  process.exit(1);
}

let payhip = [];
try{
  if(fs.existsSync(payhipPath)){
    payhip = readJson(payhipPath);
    if(!Array.isArray(payhip)) payhip = [];
  }
}catch(_e){ payhip = []; }

const payhipByTitle = new Map();
for(const r of payhip){
  if(r && r.title) payhipByTitle.set(String(r.title).trim().toLowerCase(), r);
}

const siteById = new Map();
const siteByTitle = new Map();
for(const p of site){
  if(p && p.id) siteById.set(String(p.id), p);
  if(p && p.title) siteByTitle.set(String(p.title).trim().toLowerCase(), p);
}

let added = 0;
let updatedPayhip = 0;

for(const p of entrepedia){
  const title = String(p.title || "").trim();
  if(!title) continue;

  const id = makeIdFromTitle(title);
  let target = siteById.get(id) || siteByTitle.get(title.toLowerCase());

  const mapped = {
    id,
    title,
    description: shortDesc(p),
    mainCategory: p.mainCategory || "Uncategorized",
    subCategory: p.subCategory || "",
    format: inferFormat(p),
    info: p.details ? JSON.stringify(p.details) : (p.meta ? JSON.stringify(p.meta) : ""),
    price: Number.isFinite(p.price) ? p.price : defaultPrice,
    compareAt: null,
    cover: "",
    payhipId: "",
    payhipUrl: "",
    bundlePayhipId: "",
    bundleLabel: "",
    bundleNote: "",
    source: "entrepedia"
  };

  const bn = safeBasename(p.coverPath || p.coverUrl || "");
  if(bn) mapped.cover = "/covers/" + bn;

  const ph = payhipByTitle.get(title.toLowerCase());
  if(ph){
    mapped.payhipId = ph.payhipId || "";
    mapped.payhipUrl = ph.url || "";
  }

  if(!target){
    site.push(mapped);
    siteById.set(mapped.id, mapped);
    siteByTitle.set(mapped.title.toLowerCase(), mapped);
    added++;
  }else{
    // Non sovrascrivere payhipUrl se già presente
    if(mapped.payhipUrl && !target.payhipUrl){
      target.payhipUrl = mapped.payhipUrl;
      target.payhipId = mapped.payhipId || target.payhipId;
      updatedPayhip++;
    }
    // Aggiorna campi descrittivi solo se vuoti (evita di rompere manual edits)
    if(!target.description && mapped.description) target.description = mapped.description;
    if(!target.mainCategory && mapped.mainCategory) target.mainCategory = mapped.mainCategory;
    if(!target.subCategory && mapped.subCategory) target.subCategory = mapped.subCategory;
    if(!target.format && mapped.format) target.format = mapped.format;
    if((!target.cover || target.cover === "/covers/") && mapped.cover) target.cover = mapped.cover;
    if(!Number.isFinite(target.price) || target.price === 0) target.price = mapped.price;
  }
}

fs.writeFileSync(sitePath, JSON.stringify(site, null, 2), "utf8");
console.log("OK. site before:", site.length - added, "site after:", site.length);
console.log("ADDED:", added);
console.log("UPDATED payhip links:", updatedPayhip);
console.log("WROTE:", path.resolve(sitePath));
