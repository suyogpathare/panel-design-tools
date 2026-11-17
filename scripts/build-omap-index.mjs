// Builds public/data/omap.json: which antibodies (by RRID and clone) are used in
// HuBMAP Organ Mapping Antibody Panels (OMAPs), from the Human Reference Atlas
// digital objects (CC BY 4.0). Run with Node 18+:  node scripts/build-omap-index.mjs
import { writeFile, mkdir } from "node:fs/promises";

const CDN = "https://cdn.humanatlas.io/digital-objects";
const OUT = new URL("../public/data/omap.json", import.meta.url);

const getJson = async (u) => {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(u);
    if (r.ok) return r.json();
    await new Promise((s) => setTimeout(s, 1000 * (i + 1)));
  }
  throw new Error(`fetch failed: ${u}`);
};

// "Human Lymph Node" -> "Lymph node"; falls back to the slug ("22-skin-cell-dive" -> "Skin").
function tissueName(fromTitle, slug, method) {
  let t = fromTitle;
  if (!t) {
    const m = (method || "").toLowerCase().replace(/\s+/g, "-");
    t = slug.replace(/^\d+-/, "").replace(new RegExp(`-${m}$`), "").replace(/-/g, " ");
  }
  t = t.replace(/^human /i, "").toLowerCase().replace(/\(ffpe\)/, "(FFPE)");
  return t[0].toUpperCase() + t.slice(1);
}

const catalog = (await getJson(`${CDN}/catalog.json`))["@graph"];
const current = catalog
  .filter((n) => /^https:\/\/lod\.humanatlas\.io\/omap\/[^/]+$/.test(n["@id"] || "") && n["dcat:hasCurrentVersion"])
  .map((n) => n["dcat:hasCurrentVersion"]["@id"].replace("https://lod.humanatlas.io/", ""))
  .sort((a, b) => parseInt(a.split("/")[1]) - parseInt(b.split("/")[1]));

const panels = [];
const antibodies = {}; // RRID -> [{p, clone, hgnc, isotype}]
const hgncIds = new Set();

for (const path of current) {
  const g = await getJson(`${CDN}/${path}/graph.json`);
  const d = g.data;
  const [, slug, version] = path.split("/");
  const desc = g.metadata.description || "";
  const title = (desc.match(/(OMAP-\d+)[^:]*?(?:for|of)?.*?Imaging of (.+?) with (.+?)(?: dataset)?\.?$/i) || []);
  const p = panels.length;
  panels.push({
    id: `OMAP-${slug.split("-")[0]}`,
    tissue: tissueName(title[2], slug, d.experiment?.study_method),
    method: d.experiment?.study_method || title[3] || "",
    preservation: d.experiment?.tissue_preservation || "",
    data: `${CDN}/${path}/graph.json`,
    version,
  });
  const meta = Object.fromEntries((d.antibody || []).map((a) => [a.id, a]));
  for (const c of d.cycles || []) {
    for (const u of c.uses_antibodies || []) {
      const rrid = (u.antibody_id || "").split("RRID:")[1];
      if (!rrid) continue;
      const a = meta[u.antibody_id] || {};
      const hgnc = (u.detects?.protein_id || []).find((x) => x.startsWith("HGNC:")) || null;
      if (hgnc) hgncIds.add(hgnc);
      const list = (antibodies[rrid] ||= []);
      if (!list.some((x) => x.p === p)) {
        list.push({ p, clone: a.clone_id || "", hgnc, host: a.host || "", isotype: u.based_on?.isotype || "", conjugate: a.conjugate || "" });
      }
    }
  }
  console.log(path, (d.antibody || []).length, "antibodies");
}

// HGNC id -> approved symbol, so the page can match on gene symbol.
const symbols = {};
const ids = [...hgncIds];
for (let i = 0; i < ids.length; i += 8) {
  await Promise.all(ids.slice(i, i + 8).map(async (id) => {
    try {
      const r = await fetch(`https://rest.genenames.org/fetch/hgnc_id/${id.split(":")[1]}`, { headers: { Accept: "application/json" } });
      const j = await r.json();
      symbols[id] = j.response.docs[0]?.symbol || null;
    } catch { symbols[id] = null; }
  }));
}
for (const list of Object.values(antibodies)) for (const x of list) { x.gene = symbols[x.hgnc] || null; delete x.hgnc; }

await mkdir(new URL("../public/data/", import.meta.url), { recursive: true });
await writeFile(OUT, JSON.stringify({
  source: "HuBMAP Human Reference Atlas, Organ Mapping Antibody Panels (OMAPs)",
  license: "CC BY 4.0",
  generated: new Date().toISOString().slice(0, 10),
  panels,
  antibodies,
}));
console.log(`${panels.length} panels, ${Object.keys(antibodies).length} antibodies, ${ids.length} genes -> ${OUT.pathname}`);
