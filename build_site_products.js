const fs = require("fs");

const INPUT = "entrepedia-scraper/entrepedia_products.json";
const OUTPUT = "products.json";

if (!fs.existsSync(INPUT)) {
  console.error("❌ File non trovato:", INPUT);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(INPUT, "utf-8"));

const map = new Map();

for (const p of raw) {
  const key = `${p.id}__${p.source || "entrepedia"}`;
  if (!map.has(key)) {
    map.set(key, {
      id: p.id,
      slug: p.slug,
      title: p.title,
      description: p.description,
      shortDescription: p.shortDescription || "",
      category: p.category || "Marketing",
      subcategory: p.subcategory || "",
      label: p.label || "BOOK",
      formatInfo:
        p.pages && p.size ? `${p.pages} pages • ${p.size}` : "",
      price: p.price ?? null,
      oldPrice: p.oldPrice ?? null,
      discountBadge: p.discountBadge ?? null,
      payhipId: p.payhipId ?? "",
      payhipUrl: p.payhipUrl ?? "",
      cover: p.cover,
      pages: p.pages ?? null,
      size: p.size ?? null,
      source: p.source || "entrepedia"
    });
  }
}

const products = Array.from(map.values());

fs.writeFileSync(OUTPUT, JSON.stringify(products, null, 2));

console.log(`✅ Generati ${products.length} prodotti unici`);
