const fs = require('fs');
const path = require('path');

const PRODUCTS = 'products.json';
const COVERS_DIR = 'covers';
const OUT_FIXED = 'products.fixed.json';
const OUT_MISSING = 'covers_missing.txt';

const extsTry = ['.jpg', '.jpeg', '.png', '.webp', '.JPG', '.JPEG', '.PNG', '.WEBP'];

function exists(p){ try { return fs.existsSync(p); } catch { return false; } }

function findExistingCover(relCover){
  if (!relCover) return null;
  let c = relCover.trim();
  if (!c) return null;

  // normalizza: /covers/x -> covers/x
  c = c.replace(/^\/+/, '');
  if (!c.toLowerCase().startsWith('covers/')) return null;

  const abs = path.join(process.cwd(), c);
  if (exists(abs)) return '/' + c.replace(/\\/g,'/');

  const dir = path.dirname(abs);
  const base = path.basename(abs);
  const name = base.replace(/\.[^.]+$/, '');

  // prova estensioni alternative
  for (const ext of extsTry) {
    const cand = path.join(dir, name + ext);
    if (exists(cand)) return '/' + path.join(path.dirname(c), name + ext).replace(/\\/g,'/');
  }

  // prova case-insensitive sui file presenti in covers/
  try {
    const files = fs.readdirSync(dir);
    const hit = files.find(f => f.toLowerCase() === base.toLowerCase());
    if (hit) return '/' + path.join(path.dirname(c), hit).replace(/\\/g,'/');
    for (const ext of extsTry) {
      const hit2 = files.find(f => f.toLowerCase() === (name + ext).toLowerCase());
      if (hit2) return '/' + path.join(path.dirname(c), hit2).replace(/\\/g,'/');
    }
  } catch {}

  return null;
}

const products = JSON.parse(fs.readFileSync(PRODUCTS,'utf8'));
let fixedCount = 0;
let missing = [];

for (const p of products) {
  const cover = p.cover || p.image || p.img || '';
  const found = findExistingCover(cover);
  if (found && found !== cover) {
    p.cover = found;
    fixedCount++;
  }
  const finalCover = (p.cover || '').trim();
  if (finalCover && finalCover.startsWith('/covers/')) {
    const abs = path.join(process.cwd(), finalCover.replace(/^\/+/,''));
    if (!exists(abs)) {
      missing.push({ id: p.id, title: p.title, cover: finalCover });
    }
  }
}

fs.writeFileSync(OUT_FIXED, JSON.stringify(products, null, 2));
fs.writeFileSync(
  OUT_MISSING,
  missing.map(x => `${x.id || ''}\t${(x.title||'').replace(/\s+/g,' ').trim()}\t${x.cover}`).join('\n') + (missing.length?'\n':'')
);

console.log('PRODUCTS', products.length);
console.log('FIXED_COVER_PATHS', fixedCount);
console.log('MISSING_COVERS', missing.length);
console.log('WROTE', OUT_FIXED, 'and', OUT_MISSING);
