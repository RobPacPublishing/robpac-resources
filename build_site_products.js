const fs = require("fs");

/**
 * build_site_products.js
 * - Reads Entrepedia scraper output
 * - Writes /products.json used by index.html
 * - Robust to missing "id" in scraper records (prevents collapsing to 1 product)
 */

const OUTPUT = "products.json";

// Try common input locations (run from repo root)
const CANDIDATE_INPUTS = [
  "entrepedia-scraper/entrepedia_products.json",
  "entrepedia_products.json"
];

function firstExistingPath(paths) {
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function pickFirstString(...vals) {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

const INPUT = firstExistingPath(CANDIDATE_INPUTS);

if (!INPUT) {
  console.error("❌ File non trovato. Cercati questi path:", CANDIDATE_INPUTS);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(INPUT, "utf-8"));

if (!Array.isArray(raw)) {
  console.error("❌ Input non valido: atteso un array JSON:", INPUT);
  process.exit(1);
}

const seen = new Set();
const usedIds = new Set();

function uniqueId(base, fallback) {
  const baseSlug = slugify(base) || slugify(fallback) || "p";
  let out = baseSlug;
  let k = 2;
  while (usedIds.has(out)) {
    out = `${baseSlug}-${k++}`;
  }
  usedIds.add(out);
  return out;
}

const products = [];

for (let i = 0; i < raw.length; i++) {
  const p = raw[i] || {};
  const title = pickFirstString(p.title, p.name);
  if (!title) continue;

  const source = pickFirstString(p.source, "entrepedia");

  // Stable dedupe key (never rely only on p.id)
  const dedupeKey = [
    pickFirstString(p.payhipId, p.id, p.slug, title).toLowerCase(),
    source.toLowerCase()
  ].join("__");

  if (seen.has(dedupeKey)) continue;
  seen.add(dedupeKey);

  const id = uniqueId(p.id || p.slug || p.payhipId || title, title);
  const slug = pickFirstString(p.slug, slugify(title), id);

  const cover = pickFirstString(
    p.cover,
    p.coverFile,
    p.coverFilename,
    p.image,
    p.imageFile,
    p.thumbnail,
    p.thumb,
    p.cover_path
  );

  const pages = p.pages ?? null;
  const size = p.size ?? null;

  products.push({
    id,
    slug,
    title,
    description: pickFirstString(p.description, p.longDescription, ""),
    shortDescription: pickFirstString(p.shortDescription, p.summary, ""),
    category: pickFirstString(p.category, "Marketing"),
    subcategory: pickFirstString(p.subcategory, ""),
    label: pickFirstString(p.label, p.format, "BOOK"),
    formatInfo: pickFirstString(
      p.formatInfo,
      (pages && size) ? `${pages} pages • ${size}` : ""
    ),
    price: p.price ?? null,
    oldPrice: p.oldPrice ?? null,
    discountBadge: p.discountBadge ?? null,
    payhipId: pickFirstString(p.payhipId, ""),
    payhipUrl: pickFirstString(p.payhipUrl, ""),
    cover,
    pages: pages ?? null,
    size: size ?? null,
    source
  });
}

fs.writeFileSync(OUTPUT, JSON.stringify(products, null, 2), "utf-8");

console.log(`✅ Generati ${products.length} prodotti unici`);
