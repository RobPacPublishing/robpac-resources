const fs = require("fs");
const path = require("path");

const INPUT = "entrepedia-scraper/entrepedia_products.json";
const OUTPUT = "products.json";
const COVERS_DIR = "covers";

function readJsonSafe(p) {
  const txt = fs.readFileSync(p, "utf-8");
  return JSON.parse(txt);
}

function arrify(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.products)) return raw.products;
  if (raw && Array.isArray(raw.items)) return raw.items;
  return [];
}

function stripDiacritics(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function slugify(s) {
  return stripDiacritics(String(s || ""))
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function toNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  // keep digits, dot, comma
  const cleaned = s.replace(/[^0-9.,-]/g, "");
  if (!cleaned) return null;
  // handle comma decimals
  const norm = cleaned.includes(",") && !cleaned.includes(".")
    ? cleaned.replace(",", ".")
    : cleaned.replace(/,/g, "");
  const n = parseFloat(norm);
  return Number.isFinite(n) ? n : null;
}

function normalizeFormat(p) {
  const raw = (p.format || p.label || p.type || p.kind || "").toString().trim();
  const s = raw.toLowerCase();

  if (s.includes("prompt")) return "prompt_pack";
  if (s.includes("check")) return "checklist";
  if (s.includes("workbook")) return "workbook";
  if (s.includes("template")) return "template";
  if (s.includes("audio")) return "audio";
  if (s.includes("video")) return "video";
  if (s.includes("guide")) return "guide";
  if (s.includes("book") || s.includes("ebook")) return "book";

  // fallback: slug of raw
  const sl = slugify(raw);
  return sl || "book";
}

function loadCoversIndex() {
  const idx = new Map();
  if (!fs.existsSync(COVERS_DIR)) return idx;

  const files = fs.readdirSync(COVERS_DIR, { withFileTypes: true })
    .filter(d => d.isFile())
    .map(d => d.name)
    .filter(name => /\.(jpe?g|png|webp)$/i.test(name));

  for (const name of files) {
    const base = name.replace(/\.(jpe?g|png|webp)$/i, "");
    idx.set(slugify(base), name);
    // also store exact base (case-insensitive) without slug transformations
    idx.set(base.toLowerCase(), name);
  }
  return idx;
}

function extractFilenameFromCover(cover) {
  if (!cover) return "";
  const s = String(cover).split("?")[0].split("#")[0].trim();
  if (!s) return "";
  // if it's a URL or path, take last segment
  const parts = s.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || "";
}

function resolveCover(p, coversIndex) {
  // 1) if cover already points to /covers/..., keep it (but try to correct filename)
  const rawCover = p.cover || p.image || p.coverImage || p.cover_url || p.coverUrl || "";
  const fn = extractFilenameFromCover(rawCover);

  const candidates = [];
  if (fn) {
    candidates.push(slugify(fn.replace(/\.(jpe?g|png|webp)$/i, "")));
    candidates.push(fn.replace(/\.(jpe?g|png|webp)$/i, "").toLowerCase());
  }

  const title = p.title || p.name || "";
  const slugTitle = slugify(title);
  if (slugTitle) candidates.push(slugTitle);

  // some scrapers save "coverFile" or similar
  const coverFile = p.coverFile || p.cover_filename || p.coverFilename || "";
  if (coverFile) {
    candidates.push(slugify(extractFilenameFromCover(coverFile).replace(/\.(jpe?g|png|webp)$/i, "")));
    candidates.push(extractFilenameFromCover(coverFile).replace(/\.(jpe?g|png|webp)$/i, "").toLowerCase());
  }

  for (const c of candidates) {
    if (!c) continue;
    const match = coversIndex.get(c);
    if (match) return `/covers/${match}`;
  }

  // last resort: if rawCover is already a relative path, keep it
  if (rawCover && !/^https?:\/\//i.test(rawCover)) {
    // normalize backslashes
    const rel = String(rawCover).replace(/\\/g, "/");
    return rel.startsWith("/") ? rel : `/${rel}`;
  }

  return ""; // will fallback to placeholder in UI
}

function stableKey(p, i) {
  const source = (p.source || p.vendor || p.origin || "entrepedia").toString().trim() || "entrepedia";
  const id =
    (p.payhipId || p.payhip_id || "").toString().trim() ||
    (p.id || p.productId || p.product_id || "").toString().trim() ||
    (p.slug || p.handle || p.permalink || "").toString().trim() ||
    (p.title || p.name || "").toString().trim() ||
    String(i);

  return `${source}__${id}`;
}

if (!fs.existsSync(INPUT)) {
  console.error("❌ File non trovato:", INPUT);
  process.exit(1);
}

const raw = readJsonSafe(INPUT);
const list = arrify(raw);

const coversIndex = loadCoversIndex();
const map = new Map();

for (let i = 0; i < list.length; i++) {
  const p = list[i] || {};
  const key = stableKey(p, i);

  if (map.has(key)) continue;

  const title = (p.title || p.name || "").toString().trim();
  if (!title) continue;

  const mainCategory = (p.mainCategory || p.category || p.categoryName || p.cat || "").toString().trim();
  const subCategory = (p.subCategory || p.subcategory || p.subCategoryName || p.subcat || "").toString().trim();

  const pages = p.pages ?? p.pageCount ?? null;
  const size = p.size ?? p.fileSize ?? null;

  const info =
    (p.info || p.formatInfo || p.details || "").toString().trim() ||
    (pages || size ? `${pages ? `${pages} pages` : ""}${pages && size ? " • " : ""}${size ? `${size}` : ""}`.trim() : "");

  const price = toNumber(p.price);
  const compareAt = toNumber(p.compareAt ?? p.oldPrice ?? p.listPrice);

  map.set(key, {
    id: p.id ?? p.productId ?? p.product_id ?? key,
    title,
    description: (p.description || p.shortDescription || p.desc || "").toString().trim(),
    mainCategory,
    subCategory,
    format: normalizeFormat(p),
    info,
    price: price === null ? 0 : price,
    compareAt: compareAt === null ? null : compareAt,
    cover: resolveCover(p, coversIndex),

    // payhip / bundle fields (keep empty if missing)
    payhipId: (p.payhipId || p.payhip_id || "").toString().trim(),
    payhipUrl: (p.payhipUrl || p.payhip_url || "").toString().trim(),
    bundlePayhipId: (p.bundlePayhipId || p.bundle_payhip_id || "").toString().trim(),
    bundleLabel: (p.bundleLabel || "").toString().trim(),
    bundleNote: (p.bundleNote || "").toString().trim(),

    source: (p.source || "entrepedia").toString().trim()
  });
}

const products = Array.from(map.values());

fs.writeFileSync(OUTPUT, JSON.stringify(products, null, 2), "utf-8");

console.log(`✅ Generati ${products.length} prodotti`);
