const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const cheerio = require("cheerio");

// Sostituzione "your customers" -> "you"
function replacePronouns(text) {
  if (!text) return text;
  let out = text;

  out = out.replace(/your customers/gi, (m) =>
    m[0] === "Y" ? "You" : "you"
  );
  out = out.replace(/your customer/gi, (m) =>
    m[0] === "Y" ? "You" : "you"
  );

  return out;
}

// Estrae Pages / Words / Size dalla parte alta della pagina (fallback)
function extractStatsFromHtml(html) {
  let pages = null;
  let words = null;
  let size = null;

  // Estrae tutte le occorrenze "Pages ... numero"
  const pagesMatches = [...html.matchAll(/Pages?[^0-9]{0,80}(\d{1,5})/gi)];
  if (pagesMatches.length) {
    const nums = pagesMatches
      .map(m => parseInt(m[1], 10))
      .filter(n => !isNaN(n));
    if (nums.length) {
      pages = Math.max(...nums);
    }
  }

  const mWords = html.match(/Words?[^0-9]{0,80}([\d.,]+)/i);
  if (mWords) {
    const clean = mWords[1].replace(/[,\.]/g, "");
    const n = parseInt(clean, 10);
    if (!isNaN(n)) {
      words = n;
    }
  }

  const mSize = html.match(/Size[^0-9]{0,80}([\d.,]+\s*(?:KB|MB|GB))/i);
  if (mSize) {
    size = mSize[1].trim();
  }

  // Se le pagine sembrano troppo poche rispetto alle words,
  // ricalcola una stima dalle words (circa 180 parole a pagina).
  if (words && (!pages || pages < Math.round(words / 400))) {
    pages = Math.round(words / 180);
  }

  return { pages, words, size };
}


// Estrae blocco destro: "This product contains", "You are free to", "Details"
function extractSidebarData($) {
  const result = {
    productContains: [],
    licenseFreeTo: [],
    details: {}
  };

  let sidebar = null;

  $("*").each((i, el) => {
    const t = $(el).text().trim();
    if (/This product contains/i.test(t)) {
      sidebar = $(el).closest("aside, section, div");
      return false;
    }
  });

  if (!sidebar || !sidebar.length) {
    return result;
  }

  const lines = sidebar
    .text()
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l);

  let mode = null;

  for (const line of lines) {
    if (/^This product contains/i.test(line)) {
      mode = "contains";
      continue;
    }
    if (/^You are free to/i.test(line)) {
      mode = "free";
      continue;
    }
    if (/^Details$/i.test(line)) {
      mode = "details";
      continue;
    }

    if (mode === "contains") {
      if (line && !/^You are free to/i.test(line)) {
        result.productContains.push(line);
      }
      continue;
    }

    if (mode === "free") {
      if (/^Details$/i.test(line)) {
        mode = "details";
        continue;
      }
      result.licenseFreeTo.push(line);
      continue;
    }

    if (mode === "details") {
      const mType = line.match(/File type\s*:?\s*(.+)/i);
      if (mType) {
        result.details.fileType = mType[1].trim();
        continue;
      }
      const mSize = line.match(/File size\s*:?\s*(.+)/i);
      if (mSize) {
        result.details.fileSize = mSize[1].trim();
        continue;
      }
      const mPages = line.match(/Pages\s*:?\s*(\d+)/i);
      if (mPages) {
        result.details.pages = parseInt(mPages[1], 10);
        continue;
      }
      const mWords = line.match(/Words\s*:?\s*([\d,]+)/i);
      if (mWords) {
        const clean = mWords[1].replace(/,/g, "");
        const n = parseInt(clean, 10);
        if (!isNaN(n)) {
          result.details.words = n;
        }
        continue;
      }
      const mDate = line.match(/Date added\s*:?\s*(.+)/i);
      if (mDate) {
        result.details.dateAdded = mDate[1].trim();
        continue;
      }
    }
  }

  return result;
}

// Costruisce la descrizione completa (intro + sezioni) partendo dal blocco che contiene "What's Inside"
function buildDescription($) {
  const parts = [];

  const stopRegexes = [
    /^This product contains/i,
    /^You are free to/i,
    /^Details$/i
  ];

  const skipRegexes = [
    /^Pages\b/i,
    /^Words\b/i,
    /^Size\b/i,
    /^File type\b/i,
    /^File size\b/i,
    /^\d+$/,
    /^[\d,]+$/,
    /^[\d.,]+\s*(?:KB|MB|GB)$/i
  ];

  // 1) cerco un contenitore che includa "What's Inside"
  let contentRoot = null;
  $("*").each((i, el) => {
    const t = $(el).text().trim();
    if (/What['’]s Inside/i.test(t)) {
      contentRoot = $(el).closest("section, main, article, div");
      return false;
    }
  });

  // se non lo trovo, ripiego sull'intero body
  if (!contentRoot || !contentRoot.length) {
    contentRoot = $("body");
  }

  contentRoot.find("*").each((i, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    if (!text) return;

    if (stopRegexes.some((re) => re.test(text))) {
      return false;
    }

    if (skipRegexes.some((re) => re.test(text))) {
      return;
    }

    if ($el.is("p")) {
      parts.push(text);
    } else if ($el.is("h2, h3")) {
      parts.push(text.toUpperCase());
    } else if ($el.is("ul, ol")) {
      $el.find("li").each((j, li) => {
        const liText = $(li).text().trim();
        if (liText) {
          parts.push("• " + liText);
        }
      });
    }
  });

  if (!parts.length) return null;

  // Pulizia "menu" iniziale (Product Mockups, Book Covers, ecc.)
  let lines = parts
    .join("\n\n")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l);

  let start = 0;
  for (; start < lines.length; start++) {
    const line = lines[start];

    // voci di menu/globali da buttare
    if (/^Access all premium content/i.test(line)) continue;
    if (/^Sign In$/i.test(line)) continue;
    if (/Product Mockups|Book Covers|Special Deals|PDF Rebrander|Product Descriptions|Product Ideas|Book Title Generator/i.test(line)) continue;
    if (/^•\s+/.test(line)) continue; // bullet list iniziali, prima della vera descrizione

    // prima riga "seria"
    break;
  }

  if (start > 0 && start < lines.length) {
    lines = lines.slice(start);
  }

  const cleaned = lines.join("\n\n");
  return replacePronouns(cleaned);
}

// Stima il tipo di contenuto (ebook, audio, video, ecc.)
function guessContentType(productContains) {
  const joined = (productContains || []).join(" ").toLowerCase();
  if (!joined) return null;

  if (joined.includes("podcast") || joined.includes("audio")) return "audio";
  if (joined.includes("video")) return "video";
  if (joined.includes("slide") || joined.includes("presentation")) return "slides";
  if (joined.includes("workbook")) return "workbook";
  if (joined.includes("checklist")) return "checklist";
  if (joined.includes("template")) return "template";
  if (joined.includes("ebook") || joined.includes("book")) return "ebook";

  return null;
}

// Stima categoria principale e sotto-categoria sulla base del testo HTML
function guessCategories(html) {
  const lower = html.toLowerCase();

  const mappings = [
    { needle: "funnels", main: "Marketing", sub: "Funnels" },
    { needle: "email marketing", main: "Marketing", sub: "Email Marketing" },
    { needle: "copywriting", main: "Marketing", sub: "Copywriting" },
    { needle: "seo", main: "Marketing", sub: "SEO" },
    { needle: "social media", main: "Marketing", sub: "Social Media" },
    { needle: "sales", main: "Sales & Conversion", sub: "Sales" },
    { needle: "business & entrepreneurship", main: "Business & Growth", sub: "Business & Entrepreneurship" },
    { needle: "business and entrepreneurship", main: "Business & Growth", sub: "Business & Entrepreneurship" },
    { needle: "productivity", main: "Productivity & Systems", sub: "Productivity" },
    { needle: "creator", main: "Creator & Media", sub: "Creator Economy" },
    { needle: "freelance", main: "Career & Freelancing", sub: "Freelancing" }
  ];

  let mainCategory = null;
  const subs = [];

  for (const m of mappings) {
    if (lower.includes(m.needle)) {
      if (!mainCategory) mainCategory = m.main;
      if (m.sub && !subs.includes(m.sub)) subs.push(m.sub);
    }
  }

  return {
    mainCategory: mainCategory,
    subCategory: subs.length ? subs.join(", ") : null
  };
}

// Suggerisce la label per il badge (VIDEO, GUIDE, BOOK, AUDIO, TEMPLATE, ecc.)
function guessLabelSuggestion(contentType, productContains, description) {
  const joinedContains = (productContains || []).join(" ").toLowerCase();
  const descLower = (description || "").toLowerCase();

  if (contentType === "ebook") return "BOOK";
  if (contentType === "audio") return "AUDIO";
  if (contentType === "video") return "VIDEO";
  if (contentType === "workbook") return "WORKBOOK";
  if (contentType === "checklist") return "CHECKLIST";
  if (contentType === "template") return "TEMPLATE";

  if (joinedContains.includes("prompt") || descLower.includes("prompt")) {
    return "PROMPT PACK";
  }

  if (joinedContains.includes("checklist")) return "CHECKLIST";
  if (joinedContains.includes("workbook")) return "WORKBOOK";
  if (joinedContains.includes("template")) return "TEMPLATE";

  // fallback generico
  return null;
}

// Crea una shortDescription dal primo paragrafo "vero"
function buildShortDescription(longDescription) {
  if (!longDescription) return null;

  const paragraphs = longDescription
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p);

  for (const p of paragraphs) {
    // salta headings in maiuscolo o bullet
    if (p.startsWith("•")) continue;
    if (p === p.toUpperCase()) continue;

    let s = p;
    const maxLen = 260;
    if (s.length > maxLen) {
      const cut = s.slice(0, maxLen);
      const lastSpace = cut.lastIndexOf(" ");
      s = cut.slice(0, lastSpace > 40 ? lastSpace : maxLen) + "…";
    }
    return s;
  }

  // fallback: primi 200 caratteri
  const trimmed = longDescription.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed;
}


// Estrae l'URL della cover principale dal DOM
function extractCoverUrl($, baseUrl, title) {
  const candidates = [];

  $("img").each((i, el) => {
    const $el = $(el);
    const src = $el.attr("src") || "";
    if (!src) return;

    if (!/\.(png|jpe?g|webp)$/i.test(src)) return;

    const lower = src.toLowerCase();
    if (
      lower.includes("logo") ||
      lower.includes("icon") ||
      lower.includes("avatar") ||
      lower.includes("favicon")
    ) {
      return;
    }

    let absolute;
    try {
      absolute = new URL(src, baseUrl).href;
    } catch (e) {
      absolute = src;
    }

    const alt = ($el.attr("alt") || "").toLowerCase();
    candidates.push({ src: absolute, alt, index: i });
  });

  if (!candidates.length) return null;

  const titleLower = (title || "").toLowerCase();

  const byAltMatch = candidates.find((c) => {
    if (!c.alt) return false;
    if (c.alt.includes("cover") || c.alt.includes("mockup")) return true;
    if (titleLower && c.alt.includes(titleLower)) return true;
    return false;
  });

  if (byAltMatch) return byAltMatch.src;

  return candidates[0].src;
}

// Scarica l'immagine se non è già presente in locale
async function downloadImageIfNeeded(imageUrl, targetPath) {
  if (!imageUrl || !targetPath) return;

  if (fs.existsSync(targetPath)) {
    return;
  }

  try {
    const res = await fetch(imageUrl);
    if (!res.ok) {
      console.warn(`   !! Impossibile scaricare cover (${res.status}) da ${imageUrl}`);
      return;
    }
    const buffer = await res.buffer();
    fs.writeFileSync(targetPath, buffer);
    console.log(`   -> Cover salvata in: ${targetPath}`);
  } catch (err) {
    console.warn(`   !! Errore scaricando la cover da ${imageUrl}: ${err.message}`);
  }
}

async function scrapeUrl(url) {
  console.log(`\n>>> Scraping: ${url}`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const h1 = $("h1").first();
  const title = h1.text().trim() || null;

  const { pages, words, size } = extractStatsFromHtml(html);
  const sidebarData = extractSidebarData($);
  const description = buildDescription($);
  const shortDescription = buildShortDescription(description);
  const contentType = guessContentType(sidebarData.productContains);
  const categories = guessCategories(html);
  const labelSuggestion = guessLabelSuggestion(
    contentType,
    sidebarData.productContains,
    description
  );

  // Estrae e scarica la cover principale del prodotto (mockup/cover libro)
  const coverUrl = extractCoverUrl($, url, title);
  let coverFileName = null;
  let coverPathRelative = null;

  if (coverUrl) {
    try {
      const u = new URL(coverUrl);
      coverFileName = path.basename(u.pathname);
      if (coverFileName) {
        const coversDir = path.join(__dirname, "..", "covers");
        if (!fs.existsSync(coversDir)) {
          fs.mkdirSync(coversDir, { recursive: true });
        }
        const coverPath = path.join(coversDir, coverFileName);
        coverPathRelative = path.join("covers", coverFileName).replace(/\\/g, "/");
        await downloadImageIfNeeded(coverUrl, coverPath);
      }
    } catch (e) {
      console.warn("   !! Errore nel calcolo del nome file cover:", e.message);
    }
  }

  const metaParts = [];

  if (contentType === "ebook") metaParts.push("Ebook");
  else if (contentType === "audio") metaParts.push("Audio");
  else if (contentType === "video") metaParts.push("Video course");

  const finalPages = sidebarData.details.pages || pages || null;
  const finalWords = sidebarData.details.words || words || null;
  const finalSize = sidebarData.details.fileSize || size || null;

  if (finalPages) metaParts.push(`${finalPages} pages`);
  if (finalWords) metaParts.push(`${finalWords.toLocaleString("en-US")} words`);
  if (finalSize) metaParts.push(finalSize);

  const meta = metaParts.length ? metaParts.join(" · ") : null;

  return {
    url,
    title,
    description,
    shortDescription,
    meta,
    pages: finalPages,
    words: finalWords,
    size: finalSize,
    productContains: sidebarData.productContains,
    licenseFreeTo: sidebarData.licenseFreeTo,
    details: sidebarData.details,
    contentType,
    mainCategory: categories.mainCategory,
    subCategory: categories.subCategory,
    labelSuggestion,
    coverUrl,
    coverPath: coverPathRelative
  };
}

async function main() {
  const urlsPath = path.join(__dirname, "urls.txt");
  if (!fs.existsSync(urlsPath)) {
    console.error("Errore: manca urls.txt nella stessa cartella dello script.");
    process.exit(1);
  }

  const rawLines = fs
    .readFileSync(urlsPath, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  const lines = Array.from(new Set(rawLines));

  if (lines.length !== rawLines.length) {
    console.log(`Trovati ${rawLines.length - lines.length} URL duplicati in urls.txt (verranno ignorati).`);
  }


  if (!lines.length) {
    console.error("Errore: urls.txt è vuoto o contiene solo commenti.");
    process.exit(1);
  }

  const results = [];

  for (const url of lines) {
    try {
      const data = await scrapeUrl(url);
      results.push(data);
    } catch (err) {
      console.error(`   !! Errore su ${url}: ${err.message}`);
    }
  }

  const outPath = path.join(__dirname, "entrepedia_products.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  console.log(`\n=== Fatto. Salvato in: ${outPath} ===`);
}

main().catch((err) => {
  console.error("Errore generale:", err);
  process.exit(1);
});
