// build_site_products.js
//
// Genera/aggiorna il catalogo products.json del sito
// a partire da entepedia-scraper/entrepedia_products.json.
//
// Uso:
//   cd /d/robpac-resources
//   node build_site_products.js
//
const fs = require('fs');
const path = require('path');

const SITE_ROOT = __dirname;
const ENT_DIR = path.join(SITE_ROOT, 'entrepedia-scraper');

const SITE_PRODUCTS_PATH = path.join(SITE_ROOT, 'products.json');
const ENT_PRODUCTS_PATH = path.join(ENT_DIR, 'entrepedia_products.json');

function loadJson(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Errore leggendo', p, err.message);
    return fallback;
  }
}

// Carica catalogo esistente (se c'è)
const existing = loadJson(SITE_PRODUCTS_PATH, []);
// Carica prodotti Entrepedia
const ent = loadJson(ENT_PRODUCTS_PATH, []);

if (!ent.length) {
  console.error('Nessun prodotto in', ENT_PRODUCTS_PATH);
  process.exit(1);
}

// Mappa esistenti per titolo (chiave semplice ma pratica per ora)
const byKey = new Map();
for (const p of existing) {
  const key = (p.slug || p.id || p.title || '').toLowerCase();
  if (key) byKey.set(key, p);
}

function slugify(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const merged = [];

for (const e of ent) {
  if (!e || !e.title) continue;
  const key = e.title.toLowerCase();

  const prev = byKey.get(key) || {};

  // Info formato: pagine + size
  let formatInfo = '';
  if (e.pages || e.size) {
    const parts = [];
    if (e.pages) parts.push(`${e.pages} pages`);
    if (e.size) parts.push(`${e.size}`);
    formatInfo = parts.join(' • ');
  } else if (e.meta) {
    formatInfo = e.meta;
  }

  const record = {
    // Identificatore stabile
    id: prev.id || e.id || slugify(e.title),
    slug: prev.slug || e.slug || slugify(e.title),

    // Dati principali
    title: e.title,
    description: e.description || e.shortDescription || prev.description || '',
    shortDescription: e.shortDescription || prev.shortDescription || '',
    category: e.mainCategory || prev.category || 'Marketing',
    subcategory: e.subCategory || prev.subcategory || '',
    label: prev.label || e.labelSuggestion || '',

    // Formato/durata
    formatInfo: formatInfo || prev.formatInfo || '',

    // Prezzi e badge (al momento lasciamo intatti quelli eventuali esistenti)
    price: prev.price || null,
    oldPrice: prev.oldPrice || null,
    discountBadge: prev.discountBadge || null,

    // Payhip / link esterni
    payhipId: prev.payhipId || '',
    payhipUrl: prev.payhipUrl || '',

    // Cover locale già generata dallo scraper (se presente)
    cover: prev.cover || e.coverLocalPath || e.coverPath || '',

    // Meta varie
    pages: e.pages ?? prev.pages ?? null,
    size: e.size ?? prev.size ?? null,
    words: e.words ?? prev.words ?? null,
    source: 'entrepedia'
  };

  merged.push(record);
  byKey.delete(key);
}

// Aggiunge eventuali prodotti già esistenti non presenti in Entrepedia
for (const leftover of byKey.values()) {
  merged.push(leftover);
}

// Ordina alfabeticamente
merged.sort((a, b) => a.title.localeCompare(b.title));

fs.writeFileSync(SITE_PRODUCTS_PATH, JSON.stringify(merged, null, 2), 'utf8');
console.log(`Creato/aggiornato ${SITE_PRODUCTS_PATH} con ${merged.length} prodotti.`);
