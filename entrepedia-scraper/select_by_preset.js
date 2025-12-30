#!/usr/bin/env node
/**
 * select_by_preset.js (V2)
 *
 * Seleziona prodotti da un master Entrepedia APP (dedup) usando keyword su titolo+descrizione.
 * Serve quando il campo "type" non è affidabile o è vuoto.
 *
 * USO:
 *   node select_by_preset.js --in entrepedia_products_ALL_APP.dedup.json --preset promptpacks --out entrepedia_products_PROMPT.json
 *
 * Preset:
 *   promptpacks, templates, planners, scripts, graphics
 *
 * Opzioni:
 *   --regex "<pattern>"        Regex JS (senza / /), flags=i
 *   --min-score <n>            Solo per preset promptpacks (default 3)
 *   --debug <file>             Salva anche un csv con score/titolo per controlli (default: none)
 */
const fs = require("fs");
const path = require("path");

function argValue(argv, key, defVal=null){
  const i = argv.indexOf(key);
  return i === -1 ? defVal : (argv[i+1] ?? defVal);
}
function readJson(p){ return JSON.parse(fs.readFileSync(p, "utf8")); }
function writeJson(p, obj){ fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8"); }
function escCsv(s){ return `"${String(s||"").replace(/"/g,'""')}"`; }

function presetRegex(preset){
  const p = String(preset||"").toLowerCase().trim();
  switch(p){
    case "templates":
    case "template":
      return /(\btemplate(s)?\b|canva\s*template(s)?|notion\s*template(s)?|email\s*template(s)?|website\s*template(s)?)/i;
    case "planners":
    case "planner":
      return /(\bplanner(s)?\b|\bworkbook(s)?\b|\bjournal(s)?\b|\btracker(s)?\b|\bchecklist(s)?\b|\bhabit\b|\bgoal\b)/i;
    case "scripts":
    case "script":
      return /(\bscript(s)?\b|video\s*script(s)?|youtube\s*script(s)?|podcast\s*script(s)?|ad\s*script(s)?)/i;
    case "graphics":
    case "graphic":
      return /(\bgraphic(s)?\b|\bgraphics\b|\bicons?\b|\bclipart\b|\bpng\b|\bsvg\b|\bmockup(s)?\b|\bbrand\s*kit\b)/i;
    default:
      return null;
  }
}

function scorePromptPack(text){
  const t = String(text||"").toLowerCase();

  // segnali forti
  const strong = [
    /\bprompt\s*pack(s)?\b/g,
    /\bprompts?\b/g,
    /\bprompting\b/g,
    /\bprompt\s*library\b/g,
    /\bprompt\s*bundle\b/g,
    /\bprompt\s*engineering\b/g
  ];

  // segnali IA/strumenti che quasi sempre accompagnano prompt pack
  const ai = [
    /\bchatgpt\b/g,
    /\bgpt[-\s]?([34]|4o|5)\b/g,
    /\bopenai\b/g,
    /\bclaude\b/g,
    /\bgemini\b/g,
    /\bcopilot\b/g,
    /\bmidjourney\b/g,
    /\bstable\s*diffusion\b/g,
    /\bsd[xl0-9]*\b/g,
    /\bdall[-\s]?e\b/g,
    /\bleonardo\s*ai\b/g,
    /\brunway\b/g
  ];

  // possibili falsi positivi: sottrai un po' se NON compaiono prompt
  const maybeNot = [
    /\btemplate(s)?\b/g,
    /\bplanner(s)?\b/g,
    /\bworkbook(s)?\b/g,
    /\bebook(s)?\b/g,
    /\bbook(s)?\b/g
  ];

  let score = 0;
  let hasPrompt = false;

  for(const re of strong){
    const m = t.match(re);
    if(m){ score += 4; hasPrompt = true; }
  }
  for(const re of ai){
    const m = t.match(re);
    if(m) score += 1;
  }

  if(!hasPrompt){
    // se non c'è "prompt" ma ci sono tanti segnali AI, potrebbe comunque essere prompt pack
    // (es. "ChatGPT for X") — alziamo leggermente la soglia tramite score
    // qui lasciamo score così com'è
    for(const re of maybeNot){
      const m = t.match(re);
      if(m) score -= 1;
    }
  }

  return { score, hasPrompt };
}

function normalizeOutProduct(p){
  return {
    url: p.sourceUrl || p.url,
    title: p.title || "",
    description: p.description || "",
    category: p.type || p.inferredType || ""
  };
}

(function main(){
  const argv = process.argv.slice(2);
  const inFile = argValue(argv, "--in", "entrepedia_products_ALL_APP.dedup.json");
  const preset = argValue(argv, "--preset", "");
  const regexStr = argValue(argv, "--regex", "");
  const outFile = argValue(argv, "--out", "entrepedia_products_SELECTED.json");
  const minScore = Number(argValue(argv, "--min-score", "3"));
  const debugFile = argValue(argv, "--debug", "");

  const inAbs = path.resolve(process.cwd(), inFile);
  if(!fs.existsSync(inAbs)){
    console.error("FATAL: input mancante:", inAbs);
    process.exit(1);
  }

  const master = readJson(inAbs);
  const items = master.products || [];

  let picked = [];
  let debugRows = [];

  if(regexStr){
    const rx = new RegExp(regexStr, "i");
    picked = items.filter(p => rx.test(((p.title||"") + "\n" + (p.description||""))));
  }else{
    const p = String(preset||"").toLowerCase().trim();
    if(p === "promptpacks" || p === "promptpack" || p === "prompts"){
      for(const it of items){
        const hay = ((it.title||"") + "\n" + (it.description||""));
        const r = scorePromptPack(hay);
        if(r.score >= minScore){
          picked.push(it);
        }
        if(debugFile){
          debugRows.push([r.score, r.hasPrompt ? 1 : 0, it.title || "", (it.sourceUrl||"")]);
        }
      }
    }else{
      const rx = presetRegex(preset);
      if(!rx){
        console.error("FATAL: preset non valido. Usa --preset promptpacks/templates/planners/scripts/graphics oppure --regex <pattern>.");
        process.exit(1);
      }
      picked = items.filter(p => rx.test(((p.title||"") + "\n" + (p.description||""))));
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    filter: regexStr ? { regex: regexStr } : { preset, minScore: preset ? minScore : undefined },
    count: picked.length,
    products: picked.map(normalizeOutProduct)
  };

  writeJson(path.resolve(process.cwd(), outFile), out);

  if(debugFile){
    const dbgPath = path.resolve(process.cwd(), debugFile);
    const header = "score,hasPrompt,title,sourceUrl\n";
    const lines = debugRows
      .sort((a,b)=> b[0]-a[0])
      .map(r => `${r[0]},${r[1]},${escCsv(r[2])},${escCsv(r[3])}`)
      .join("\n") + "\n";
    fs.writeFileSync(dbgPath, header + lines, "utf8");
    console.log("DEBUG:", dbgPath);
  }

  console.log("OK. selected:", out.count);
  console.log("OUT:", path.resolve(process.cwd(), outFile));
})();
