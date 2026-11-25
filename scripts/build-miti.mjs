// Builds public/data/miti.json: the MITI attribute definitions (name, type,
// significance, allowed values) for each of the eight MITI tables, from the
// YAML files in github.com/miti-consortium/MITI (MIT License, © 2021
// Laboratory of Systems Pharmacology @ Harvard). Read by the MITI Checker.
//
// Run with Node 18+:
//   npm install --no-save js-yaml
//   node scripts/build-miti.mjs [commit]
// The commit defaults to COMMIT below, so the output is reproducible.
import { writeFile, mkdir } from "node:fs/promises";
import yaml from "js-yaml";

const COMMIT = process.argv[2] || "7b2cb6a165e0f4127ecbbc0b03e168f29188d99a";
const RAW = `https://raw.githubusercontent.com/miti-consortium/MITI/${COMMIT}/yaml`;
const OUT = new URL("../public/data/miti.json", import.meta.url);

const TABLES = [
  ["01-clinical", "Clinical"],
  ["02-biospecimen", "Biospecimen"],
  ["03-file", "File"],
  ["04-channel", "Channel"],
  ["05-ome-tiff-header", "OME-TIFF header"],
  ["06-processed-data", "Processed data"],
  ["07-cell", "Cell"],
  ["08-cell-state", "Cell state"],
];

const getText = async (u) => {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(u);
    if (r.ok) return r.text();
    await new Promise((s) => setTimeout(s, 1000 * (i + 1)));
  }
  throw new Error(`fetch failed: ${u}`);
};

// "required", "recommended", "optional", "required (unless n/a)", or
// { required: "SizeZ > 1" } for a conditional requirement.
function significance(s) {
  if (s && typeof s === "object") {
    const [[level, cond]] = Object.entries(s);
    return { level: String(level).trim(), when: String(cond).trim() };
  }
  const t = String(s ?? "").trim();
  if (/^required/.test(t)) return { level: "required", ...(/unless n\/a/i.test(t) ? { na: true } : {}) };
  return { level: t || "optional" };
}

const tables = [];
for (const [id, title] of TABLES) {
  const doc = yaml.load(await getText(`${RAW}/${id}.yaml`));
  const attrs = Object.entries(doc).map(([name, a]) => {
    const o = { name, type: String(a.type || "string").trim(), ...significance(a.significance) };
    if (a.description) o.desc = String(a.description).trim();
    const vv = a["valid-values"];
    if (Array.isArray(vv)) o.values = vv.map((x) => String(x).trim());
    else if (vv && typeof vv === "object") {
      if (vv.min != null) o.min = Number(vv.min);
      if (vv.max != null) o.max = Number(vv.max);
    }
    return o;
  });
  tables.push({ id, title, attrs });
  console.log(`${id}: ${attrs.length} attributes`);
}

await mkdir(new URL("../public/data/", import.meta.url), { recursive: true });
await writeFile(OUT, JSON.stringify({
  source: `https://github.com/miti-consortium/MITI/tree/${COMMIT}/yaml`,
  license: "MIT License, © 2021 Laboratory of Systems Pharmacology @ Harvard",
  commit: COMMIT,
  tables,
}) + "\n");
console.log(`wrote ${OUT.pathname}`);
