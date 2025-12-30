#!/usr/bin/env node

// apply_payhip_links_to_products.js (ROBUST)
// Usage:
//   node apply_payhip_links_to_products.js --products ./products.json --links ./payhip_links_merged.json

const fs = require('fs');
const path = require('path');

function argValue(argv, name, defVal=null){
  const i = argv.indexOf(name);
  if(i === -1) return defVal;
  const v = argv[i+1];
  if(!v || v.startsWith('--')) return defVal;
  return v;
}

function die(msg){
  console.error('FATAL:', msg);
  process.exit(1);
}

function readJson(p){
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, obj){
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

function stamp(){
  const d = new Date();
  const z = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}${z(d.getMonth()+1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

function normalizeTitle(s){
  if(!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/\u00a0/g,' ')
    .replace(/[’‘]/g,"'")
    .replace(/[“”]/g,'"')
    .replace(/&amp;/g,'&')
    .replace(/\s+/g,' ')
    .trim()
    .replace(/\s*[-–—]\s*ebook\s*$/i,'')
    .replace(/\s*\(\s*ebook\s*\)\s*$/i,'')
    .replace(/\s*ebook\s*$/i,'')
    .trim()
    .replace(/[^a-z0-9\s]/g,'')
    .replace(/\s+/g,' ')
    .trim();
}

function variants(title){
  const base = String(title || '');
  const set = new Set();
  set.add(normalizeTitle(base));
  set.add(normalizeTitle(base.split(':')[0]));
  set.add(normalizeTitle(base.split(' - ')[0]));
  set.add(normalizeTitle(base.replace(/[–—]/g,'-')));
  set.add(normalizeTitle(base.replace(/\s*[-–—]\s*Ebook\b/ig,'')));
  set.add(normalizeTitle(base.replace(/\s*\([^)]*\)\s*$/,'')));
  return Array.from(set).filter(Boolean);
}

function coerceLinks(raw){
  if(Array.isArray(raw)) return raw;

  if(raw && typeof raw === 'object'){
    const keys = ['links','items','products','data','rows','results'];
    for(const k of keys){
      if(Array.isArray(raw[k])) return raw[k];
    }

    const arrayKeys = Object.keys(raw).filter(k => Array.isArray(raw[k]));
    if(arrayKeys.length === 1) return raw[arrayKeys[0]];

    const vals = Object.values(raw);
    if(vals.length && vals.every(v => typeof v === 'string')){
      return Object.entries(raw).map(([title, url]) => {
        const id = (typeof url === 'string' && url.includes('/b/')) ? url.split('/b/')[1].split(/[?#/]/)[0] : '';
        return { title, url, payhipId: id };
      });
    }
  }

  return null;
}

function main(){
  const argv = process.argv.slice(2);
  const productsPath = argValue(argv, '--products', './products.json');
  const linksPath = argValue(argv, '--links', './payhip_links.json');

  if(!fs.existsSync(productsPath)) die(`products non trovato: ${productsPath}`);
  if(!fs.existsSync(linksPath)) die(`links non trovato: ${linksPath}`);

  const products = readJson(productsPath);
  const rawLinks = readJson(linksPath);
  const links = coerceLinks(rawLinks);

  if(!Array.isArray(products)) die('products.json deve essere un array');
  if(!Array.isArray(links)){
    const k = rawLinks && typeof rawLinks === 'object' ? Object.keys(rawLinks).slice(0,30).join(', ') : '';
    die(`links non e' un array (keys: ${k})`);
  }

  const linkMap = new Map();
  for(const r of links){
    const t = r?.title || r?.name || '';
    const url = r?.url || r?.payhipUrl || r?.link || '';
    const id = r?.payhipId || r?.id || '';
    const key = normalizeTitle(t);
    if(!key) continue;
    if(!linkMap.has(key)) linkMap.set(key, { title: t, url, payhipId: id });
  }

  const backup = `${productsPath}.bak-${stamp()}`;
  fs.copyFileSync(productsPath, backup);

  let updated = 0;
  let had = 0;
  let unmatched = 0;

  for(const p of products){
    if(p && (p.payhipUrl || p.payhipId)) had++;

    const title = p?.title || '';
    let hit = null;

    for(const v of variants(title)){
      if(linkMap.has(v)) { hit = linkMap.get(v); break; }
    }

    if(!hit){
      const vt = normalizeTitle(title);
      if(vt.length >= 8){
        for(const [k,row] of linkMap.entries()){
          if(k.length >= 8 && (k.includes(vt) || vt.includes(k))){
            hit = row;
            break;
          }
        }
      }
    }

    if(hit){
      const beforeUrl = p.payhipUrl || '';
      const beforeId = p.payhipId || '';

      const newUrl = hit.url || '';
      const newId = hit.payhipId || '';

      if((newUrl && beforeUrl !== newUrl) || (newId && beforeId !== newId)){
        if(newUrl) p.payhipUrl = newUrl;
        if(newId) p.payhipId = newId;
        updated++;
      }
    } else {
      unmatched++;
    }
  }

  writeJson(productsPath, products);

  const withUrl = products.filter(x => x && x.payhipUrl && String(x.payhipUrl).startsWith('http')).length;

  console.log('OK. Aggiornato:', path.resolve(productsPath));
  console.log('Backup:', path.resolve(backup));
  console.log('Products:', products.length);
  console.log('Avevano gia link:', had);
  console.log('Link aggiornati:', updated);
  console.log('Senza match titolo:', unmatched);
  console.log('Con payhipUrl valido:', withUrl);
}

main();
