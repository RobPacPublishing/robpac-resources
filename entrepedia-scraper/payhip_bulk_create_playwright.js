#!/usr/bin/env node
/**
 * Payhip bulk creator (Digital Products) via Playwright.
 *
 * Usa i file generati da build_payhip_payload.js:
 *   ../payhip_payload/payhip_products.json
 *   ../payhip_payload/files/<uuid>.zip
 *
 * Obiettivo: creare i prodotti in Payhip compilando automaticamente:
 * - upload file prodotto (zip)
 * - titolo
 * - prezzo
 * - descrizione
 * - cover (opzionale, se presente e trovata)
 *
 * NOTE IMPORTANTI
 * - Payhip può cambiare HTML/testi dei pulsanti: questo script usa euristiche robuste (testi/label).
 * - Consiglio: prova prima con 1 prodotto (--limit 1) e solo dopo lancia il batch completo.
 */

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = {
    payload: "../payhip_payload/payhip_products.json",
    filesDir: "../payhip_payload/files",
    coversDir: "../covers",
    stateFile: "../payhip_payload/payhip_uploaded.json",
    start: 0,
    limit: null,
    headless: false,
    slowMo: 0,
    profile: "Default",
    chromeUserData: null, // es: C:\Users\Rob\AppData\Local\Google\Chrome\User Data
    channel: "chrome", // usa Chrome installato
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--payload") args.payload = argv[++i];
    else if (a === "--files") args.filesDir = argv[++i];
    else if (a === "--covers") args.coversDir = argv[++i];
    else if (a === "--state") args.stateFile = argv[++i];
    else if (a === "--start") args.start = parseInt(argv[++i], 10) || 0;
    else if (a === "--limit") args.limit = parseInt(argv[++i], 10);
    else if (a === "--headless") args.headless = true;
    else if (a === "--slowmo") args.slowMo = parseInt(argv[++i], 10) || 0;
    else if (a === "--profile") args.profile = argv[++i];
    else if (a === "--chrome-user-data") args.chromeUserData = argv[++i];
    else if (a === "--channel") args.channel = argv[++i];
  }
  return args;
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return fallback;
  }
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

function guessChromeUserDataDir() {
  const local = process.env.LOCALAPPDATA || "";
  const candidate = path.join(local, "Google", "Chrome", "User Data");
  return candidate;
}

function coverPathForProduct(product, coversDir) {
  // Se il payload ha già un coverPath (es. "covers/Name.jpg"), proviamo a risolverlo.
  if (product.coverPath) {
    const base = path.basename(product.coverPath);
    const full = path.resolve(coversDir, base);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv);

  const payloadPath = path.resolve(__dirname, args.payload);
  const filesDir = path.resolve(__dirname, args.filesDir);
  const coversDir = path.resolve(__dirname, args.coversDir);
  const statePath = path.resolve(__dirname, args.stateFile);

  if (!fs.existsSync(payloadPath)) {
    console.error("FATAL payload not found:", payloadPath);
    process.exit(1);
  }
  if (!fs.existsSync(filesDir)) {
    console.error("FATAL files dir not found:", filesDir);
    process.exit(1);
  }

  const products = readJson(payloadPath, []);
  if (!Array.isArray(products) || products.length === 0) {
    console.error("FATAL payload empty or invalid:", payloadPath);
    process.exit(1);
  }

  ensureDir(path.dirname(statePath));
  const state = readJson(statePath, { uploaded: {} });

  // Lazy require per evitare errori se Playwright non è installato
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch (e) {
    console.error("FATAL: Playwright non è installato in questa cartella.");
    console.error("Esegui: npm i -D playwright   poi: npx playwright install chromium");
    process.exit(1);
  }

  const chromeUserData = args.chromeUserData
    ? args.chromeUserData
    : guessChromeUserDataDir();

  const context = await chromium.launchPersistentContext(chromeUserData, {
    headless: args.headless,
    slowMo: args.slowMo,
    channel: args.channel,
    args: [
      `--profile-directory=${args.profile}`,
    ],
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  // 1) Apri dashboard Payhip. Se non sei loggato, loggati manualmente e poi torna al terminale.
  await page.goto("https://payhip.com/dashboard", { waitUntil: "domcontentloaded" });

  console.log("Se non sei già loggato su Payhip in questa finestra, fai login ora.");
  console.log("Quando vedi la dashboard, torna qui: lo script prosegue da solo.");
  // aspetta che compaia un elemento “Products” in dashboard (timeout infinito)
  await page.waitForFunction(() => {
    const t = document.body ? document.body.innerText : "";
    return /Products/i.test(t) || /Dashboard/i.test(t);
  }, { timeout: 0 });

  async function clickByText(regexes, role = "button") {
    for (const rx of regexes) {
      const loc = page.getByRole(role, { name: rx }).first();
      if (await loc.count().catch(() => 0)) {
        await loc.click({ timeout: 15000 });
        return true;
      }
    }
    return false;
  }

  async function safeFillByLabel(labelRx, value) {
    const loc = page.getByLabel(labelRx).first();
    if (await loc.count().catch(() => 0)) {
      await loc.fill(String(value ?? ""));
      return true;
    }
    return false;
  }

  async function safeFillAny(selectors, value) {
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      if (await loc.count().catch(() => 0)) {
        await loc.fill(String(value ?? ""));
        return true;
      }
    }
    return false;
  }

  async function uploadViaFileChooser(clickLocator, filePath) {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 15000 }),
      clickLocator.click({ timeout: 15000 })
    ]);
    await chooser.setFiles(filePath);
  }

  function productFilePath(p) {
    if (!p.payloadFile) return null;
    const full = path.resolve(filesDir, p.payloadFile);
    return fs.existsSync(full) ? full : null;
  }

  const slice = products.slice(args.start, args.limit ? args.start + args.limit : undefined);

  let ok = 0, skipped = 0, failed = 0;

  for (const p of slice) {
    const uuid = p.uuid || "";
    if (!uuid) {
      console.log("SKIP missing uuid:", p.title);
      skipped++;
      continue;
    }
    if (state.uploaded[uuid]) {
      console.log("SKIP already uploaded:", uuid, p.title);
      skipped++;
      continue;
    }

    const filePath = productFilePath(p);
    if (!filePath) {
      console.log("FAIL missing payload file:", uuid, p.title, p.payloadFile);
      failed++;
      continue;
    }

    console.log(`\n[${ok + skipped + failed + 1}/${slice.length}] CREATE`, uuid, "-", p.title);

    try {
      // Vai alla pagina prodotti
      await page.goto("https://payhip.com/dashboard/products", { waitUntil: "domcontentloaded" });

      // Add new product
      const addOk = await clickByText([/Add new product/i, /Add product/i, /New product/i], "button")
        || await clickByText([/Add new product/i, /Add product/i, /New product/i], "link");
      if (!addOk) throw new Error("ADD_PRODUCT_BUTTON_NOT_FOUND");

      // Se appare scelta tipo prodotto, scegli Digital
      await page.waitForTimeout(500);
      await clickByText([/Digital Product/i, /Digital/i], "button").catch(()=>{});
      await clickByText([/Digital Product/i, /Digital/i], "link").catch(()=>{});

      // Attendi che si veda la form
      await page.waitForLoadState("domcontentloaded");

      // Upload product file
      // Payhip spesso usa un bottone "Upload product file"
      const uploadBtn = page.getByRole("button", { name: /Upload product file/i }).first();
      if (await uploadBtn.count().catch(()=>0)) {
        await uploadViaFileChooser(uploadBtn, filePath);
      } else {
        // fallback: primo input file nella pagina
        const fileInput = page.locator('input[type="file"]').first();
        if (await fileInput.count().catch(()=>0)) {
          await fileInput.setInputFiles(filePath);
        } else {
          throw new Error("UPLOAD_INPUT_NOT_FOUND");
        }
      }

      // Title
      const titleOk =
        (await safeFillByLabel(/Title/i, p.title)) ||
        (await safeFillAny(['input[name*="title"]', 'input[placeholder*="Title" i]'], p.title));
      if (!titleOk) throw new Error("TITLE_FIELD_NOT_FOUND");

      // Price (USD)
      const priceVal = (p.price != null) ? String(p.price) : "";
      const priceOk =
        (await safeFillByLabel(/Price/i, priceVal)) ||
        (await safeFillAny(['input[name*="price"]', 'input[placeholder*="Price" i]'], priceVal));
      if (!priceOk) console.warn("WARN price field not found (continuo)");

      // Description (textarea o editor)
      const descOk =
        (await safeFillByLabel(/Description/i, p.description || "")) ||
        (await safeFillAny(['textarea[name*="description"]', 'textarea[placeholder*="Description" i]'], p.description || ""));
      if (!descOk) {
        // fallback: prova un contenteditable
        const ed = page.locator('[contenteditable="true"]').first();
        if (await ed.count().catch(()=>0)) {
          await ed.click();
          await page.keyboard.type(String(p.description || ""), { delay: 0 });
        } else {
          console.warn("WARN description field not found (continuo)");
        }
      }

      // Cover image (opzionale, se esiste nel tuo /covers)
      const coverFull = coverPathForProduct(p, coversDir);
      if (coverFull) {
        const coverBtn = page.getByRole("button", { name: /Upload.*cover/i }).first();
        if (await coverBtn.count().catch(()=>0)) {
          await uploadViaFileChooser(coverBtn, coverFull);
        } else {
          // fallback: prova il secondo input file (spesso cover è il 2°)
          const inputs = page.locator('input[type="file"]');
          const n = await inputs.count().catch(()=>0);
          if (n >= 2) {
            await inputs.nth(1).setInputFiles(coverFull);
          }
        }
      }

      // Save / Publish
      // Payhip può avere “Add product”, “Save product”, “Publish”, “Update”
      const saved =
        await clickByText([/Add product/i, /Save product/i, /Publish/i, /Update product/i], "button");
      if (!saved) {
        // alcuni layout salvano automaticamente; proviamo ad attendere una conferma
        console.warn("WARN save button not found, provo ad attendere...");
      }

      // Attendi un attimo per upload/salvataggio
      await page.waitForTimeout(1500);

      state.uploaded[uuid] = { title: p.title, at: new Date().toISOString() };
      writeJson(statePath, state);
      ok++;
      console.log("OK", uuid);

    } catch (e) {
      failed++;
      console.log("FAIL", uuid, e && e.message ? e.message : String(e));
      // non uscire: vai avanti
    }
  }

  console.log("\nDONE", { ok, skipped, failed, state: statePath });

  await context.close();
}

main().catch((e) => {
  console.error("FATAL", e && e.message ? e.message : e);
  process.exit(1);
});
