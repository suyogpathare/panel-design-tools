// Builds public/data/dyes.json: excitation and emission spectra of the dyes used
// in tissue imaging, from FPbase (fpbase.org, CC BY-SA 4.0), resampled to 2 nm
// and scaled to a peak of 100. Used by AbScout's bleed-through check.
// Run with Node 18+:  node scripts/build-dyes.mjs
import { writeFile, mkdir } from "node:fs/promises";

const GQL = "https://www.fpbase.org/graphql/";
const OUT = new URL("../public/data/dyes.json", import.meta.url);
const MIN = 340, MAX = 860, STEP = 2;

// FPbase name -> short names it appears under in catalogs. Matching on the page
// lowercases and strips spaces/punctuation, so "Alexa Fluor 488" also matches "AF488".
const DYES = {
  "Alexa Fluor 350": ["AF350"], "Alexa Fluor 405": ["AF405"], "Alexa Fluor Plus 405": ["AF Plus 405"], "Alexa Fluor 430": ["AF430"],
  "Alexa Fluor 488": ["AF488"], "Alexa Fluor 514": ["AF514"], "Alexa Fluor 532": ["AF532"], "Alexa Fluor 546": ["AF546"],
  "Alexa Fluor 555": ["AF555"], "Alexa Fluor 568": ["AF568"], "Alexa Fluor 594": ["AF594"], "Alexa Fluor 610": ["AF610"],
  "Alexa Fluor 633": ["AF633"], "Alexa Fluor 647": ["AF647"], "Alexa Fluor 660": ["AF660"], "Alexa Fluor 680": ["AF680"],
  "Alexa Fluor 700": ["AF700"], "Alexa Fluor 750": ["AF750"], "Alexa Fluor 790": ["AF790"],
  "Fluorescein (FITC)": ["FITC", "Fluorescein"], "Tetramethylrhodamine (TAMRA, TRITC)": ["TRITC", "TAMRA"], "Texas Red": ["Texas Red"],
  "Rhodamine Red": ["Rhodamine Red", "RRX"], "Cy2": ["Cy2"], "Cy3": ["Cy3"], "Cy3.5": ["Cy3.5"], "Cy5": ["Cy5"], "Cy5.5": ["Cy5.5"], "Cy7": ["Cy7"],
  "DyLight 405": ["DL405"], "DyLight 488": ["DL488"], "DyLight 550": ["DL550"], "DyLight 633": ["DL633"], "DyLight 649": ["DL649"],
  "DyLight 680": ["DL680"], "DyLight 755": ["DL755"],
  "eFluor 450": [], "eFluor 506": [], "eFluor 570": [], "eFluor 615": [], "eFluor 660": [], "eFluor 710": [],
  "CF405M": [], "CF405S": [], "CF488A": ["CF488"], "CF532": [], "CF555": [], "CF568": [], "CF594": [], "CF633": [], "CF640R": [],
  "CF647": [], "CF660C": [], "CF680": [], "CF680R": [], "CF750": [], "CF770": [], "CF790": [],
  "ATTO 488": [], "ATTO 532": [], "ATTO 550": [], "ATTO 565": [], "ATTO 594": [], "ATTO 647N": [], "ATTO 655": [], "ATTO 680": [], "ATTO 700": [],
  "iFluor 488": [], "iFluor 647": [],
  "Opal 480": [], "Opal 520": [], "Opal 540": [], "Opal 570": [], "Opal 620": [], "Opal 650": [], "Opal 690": [], "Opal 780": [],
  "Pacific Blue": [], "Brilliant Violet 421": ["BV421"], "Super Bright 436": [], "Super Bright 600": [], "Super Bright 645": [], "Super Bright 702": [],
  "PE (R-PE / R-phycoerythrin)": ["PE", "R-PE", "Phycoerythrin"], "APC (allophycocyanin)": ["APC", "Allophycocyanin"],
  "DAPI": [], "Hoechst 33342": ["Hoechst"],
};

const gql = async (query) => {
  let last = "";
  for (let i = 0; i < 5; i++) {
    const r = await fetch(GQL, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "abscout-build/1.0" }, body: JSON.stringify({ query }) });
    if (r.ok) { const j = await r.json(); if (j.data) return j.data; throw new Error(JSON.stringify(j.errors)); }
    last = `${r.status} ${(await r.text()).slice(0, 200)}`;
    await new Promise((s) => setTimeout(s, 5000 * (i + 1)));
  }
  throw new Error(`FPbase did not answer: ${last}`);
};

// Linear interpolation onto the fixed grid; 0 outside the measured range.
function resample(points) {
  points.sort((a, b) => a[0] - b[0]);
  const out = [];
  let j = 0;
  for (let w = MIN; w <= MAX; w += STEP) {
    while (j < points.length - 2 && points[j + 1][0] < w) j++;
    const [x0, y0] = points[j], [x1, y1] = points[Math.min(j + 1, points.length - 1)];
    let y = 0;
    if (w >= points[0][0] && w <= points[points.length - 1][0]) y = x1 === x0 ? y0 : y0 + ((y1 - y0) * (w - x0)) / (x1 - x0);
    out.push(Math.max(0, y));
  }
  const peak = Math.max(...out) || 1;
  return out.map((v) => Math.round((100 * v) / peak));
}

const list = (await gql(`{ spectra(category: "D") { id subtype owner { name } } }`)).spectra;
const dyes = {};
const missing = [];
for (const [name, aliases] of Object.entries(DYES)) {
  const mine = list.filter((s) => s.owner.name === name);
  const ex = mine.find((s) => s.subtype === "EX") || mine.find((s) => s.subtype === "AB");
  const em = mine.find((s) => s.subtype === "EM");
  if (!ex || !em) { missing.push(name); continue; }
  await new Promise((s) => setTimeout(s, 400)); // stay well under FPbase's rate limit
  const d = await gql(`{ ex: spectrum(id: ${ex.id}) { data peakWave } em: spectrum(id: ${em.id}) { data peakWave } }`);
  dyes[name] = { a: aliases, ex: resample(d.ex.data), em: resample(d.em.data) };
  const pk = (arr) => MIN + STEP * arr.indexOf(100);
  dyes[name].exPeak = pk(dyes[name].ex);
  dyes[name].emPeak = pk(dyes[name].em);
}
await mkdir(new URL(".", OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ source: "FPbase (fpbase.org), CC BY-SA 4.0", built: new Date().toISOString().slice(0, 10), min: MIN, step: STEP, dyes }));
console.log(`${Object.keys(dyes).length} dyes${missing.length ? `; no EX/EM pair for: ${missing.join(", ")}` : ""}`);
