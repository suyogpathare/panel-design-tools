// Builds public/data/ko.json: knockout-based characterization of commercial
// antibodies by YCharOS, as published by Only Good Antibodies (CC BY 4.0),
// keyed by RRID. Run with Node 18+:  node scripts/build-ko-index.mjs
//
// Only the open, no-key endpoints are used (/antibodies/?preview=true, /genes/).
// Support levels are copied as published, never re-scored: YCharOS results are
// tied to their consensus protocols and cell lines.
import { writeFile, mkdir } from "node:fs/promises";

const API = "https://onlygoodantibodies.co.uk/api/v1";
const OUT = new URL("../public/data/ko.json", import.meta.url);
const APPS = ["WB", "IP", "ICC-IF", "IHC", "FC"];
const LEVEL = { supportive: "s", limited_support: "l", not_supportive: "n" }; // not_tested is omitted

const getJson = async (u) => {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(u, { headers: { Accept: "application/json", "User-Agent": "abscout-build/1.0" } });
    if (r.ok) return r.json();
    await new Promise((s) => setTimeout(s, 2000 * (i + 1)));
  }
  throw new Error(`fetch failed: ${u}`);
};

const ab = await getJson(`${API}/antibodies/?preview=true`);
if (!ab.complete || ab.antibodies.length !== ab.count) throw new Error(`incomplete: ${ab.antibodies.length}/${ab.count}`);
const gj = await getJson(`${API}/genes/`);

const genes = {}; // gene -> {page, report}
for (const g of gj.genes) genes[g.gene] = { page: g.gene_page_url, report: g.f1000_report || null };

const antibodies = {}; // RRID -> {g, r: {app: [level, qualifier]}}
let skipped = 0;
for (const a of ab.antibodies) {
  const rrid = (a.metadata?.rrid || "").trim().replace(/^RRID:/i, "");
  if (!/^AB_\d+$/.test(rrid)) { skipped++; continue; }
  const r = {};
  for (const app of APPS) {
    const lv = LEVEL[a.oga_support?.[app]];
    if (lv) r[app] = a.oga_display?.[app]?.qualifier ? [lv, a.oga_display[app].qualifier] : [lv];
  }
  if (!Object.keys(r).length) { skipped++; continue; }
  // Clone kept for monoclonals/recombinants, so the same clone sold elsewhere can be linked.
  const clone = (a.metadata?.clone_id || "").trim();
  const mono = /mono|recomb/i.test(a.metadata?.clonality || "") || /yes/i.test(a.metadata?.recombinant || "");
  antibodies[rrid] = clone && mono && !/^(n\/?a|none|-|polyclonal)$/i.test(clone) ? { g: a.gene, c: clone, r } : { g: a.gene, r };
  if (!genes[a.gene]) genes[a.gene] = { page: a.gene_page_url, report: null };
}

const out = {
  source: "YCharOS knockout characterization via Only Good Antibodies (onlygoodantibodies.co.uk), CC BY 4.0",
  built: new Date().toISOString().slice(0, 10),
  scope: ab.recommendation_scope,
  notes: ab.application_notes || {},
  genes,
  antibodies,
};
await mkdir(new URL(".", OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out));
console.log(`${Object.keys(antibodies).length} antibodies (${skipped} without RRID or results skipped), ${Object.keys(genes).length} genes`);
