// Cloudflare Worker: serves the static site from ./public and one small API,
// GET /api/antibodies?q=<target, gene, clone or catalog number>
//
// The antibody search reads two public sources at request time:
//   - Antibody Registry (antibodyregistry.org): catalog entries with RRIDs
//   - Europe PMC (europepmc.org): number of papers whose full text mentions a
//     clone together with its target, via GET /api/papers
//   - GET /api/gene?q=SYMBOL returns just the Human Protein Atlas record
//   - Human Protein Atlas (proteinatlas.org, CC BY 4.0): gene symbol and
//     synonyms (so "CD45" also searches "PTPRC"), plus HPA's own antibodies
//     and their immunohistochemistry reliability score
// Results are cached at the edge for a day to keep load on both sources low.

const REGISTRY = "https://www.antibodyregistry.org/api/fts-antibodies";
// Column filter used by the registry's own site: exact (case-insensitive) match
// on the target field, sortable by citations, with deep paging. Keyword search
// alone misses most products for short names (196 hits for "CD4" against
// 6,400+ entries whose target is CD4).
const REGISTRY_FILTER = "https://www.antibodyregistry.org/api/search/antibodies";
const FILTER_PAGE = 99; // the filter endpoint allows fewer than 100 rows per page
const FILTER_PAGES = 4; // most-cited ~400 per search, or per vendor
// Citation sort favours flow-cytometry catalogs, so also take the top page for
// each of these widely used vendors (names as the registry writes them).
const MAJOR_VENDORS = [
  "Abcam", "Cell Signaling Technology", "BioLegend", "BD Biosciences",
  "Thermo Fisher Scientific", "R and D Systems", "Novus", "Proteintech",
  "Santa Cruz Biotechnology", "Miltenyi Biotec", "Bio-Rad", "Sino Biological",
  "Leica Biosystems", "Agilent", "Roche", "Akoya Biosciences", "Standard BioTools",
  "Atlas Antibodies", "GeneTex", "Sigma-Aldrich", "Millipore", "Bio X Cell",
];
const HPA = "https://www.proteinatlas.org/api/search_download.php";
const EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const UA = "abscout/1.0 (Cloudflare Worker)";
const PAGE_SIZE = 500; // the registry serves at most the first 500 rows per search
const CACHE_SECONDS = 86400;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/antibodies") {
      return cached(request, url, ctx, CACHE_SECONDS, () => antibodyQuery(url));
    }
    if (url.pathname === "/api/antibodies/chunk") {
      return cached(request, url, ctx, CACHE_SECONDS, () => chunkQuery(url));
    }
    if (url.pathname === "/api/gene") {
      return cached(request, url, ctx, CACHE_SECONDS, () => geneQuery(url));
    }
    if (url.pathname === "/api/papers") {
      return cached(request, url, ctx, 7 * CACHE_SECONDS, () => paperQuery(url));
    }
    return env.ASSETS.fetch(request);
  },
};

// Edge cache keyed on the normalised query string; errors are not cached.
async function cached(request, url, ctx, seconds, handler) {
  if (request.method !== "GET") return json({ error: "GET only" }, 405);
  const params = [...url.searchParams.entries()]
    .map(([k, v]) => [k, v.trim().replace(/\s+/g, " ").toLowerCase()])
    .sort();
  const key = new Request(`${url.origin}${url.pathname}?${new URLSearchParams(params)}`);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  let out;
  try {
    out = await handler();
  } catch (err) {
    return json({ error: "Upstream source unavailable, try again shortly." }, 502);
  }
  if (out.error) return json({ error: out.error }, out.status || 400);
  // A partial answer (one source timed out) is cached briefly so a retry can fill it in.
  const ttl = out.partial ? 300 : seconds;
  const res = json(out, 200, { "Cache-Control": `public, max-age=${ttl}` });
  if (cache && ctx) ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

async function antibodyQuery(url) {
  const q = (url.searchParams.get("q") || "").trim().replace(/\s+/g, " ");
  const vendor = (url.searchParams.get("vendor") || "").trim();
  const species = speciesParam(url);
  if (!q) return { error: "Missing q" };
  if (q.length > 60 || vendor.length > 80) return { error: "Query too long" };
  if (species === undefined) return { error: "Unknown species" };
  return search(q, vendor, species);
}

// Optional &species=Human|Mouse|Rat: only entries whose recorded reactivity includes it
// (used by the panel builder). "" when absent, undefined when not allowed.
function speciesParam(url) {
  const s = (url.searchParams.get("species") || "").trim().toLowerCase();
  if (!s) return "";
  return ["human", "mouse", "rat"].includes(s) ? s : undefined;
}

// Europe PMC papers whose text mentions the clone AND any of the target names.
// A rough measure of how widely a clone is used; it can include unrelated
// mentions of the same string.
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9./ -]{0,24}$/;
async function paperQuery(url) {
  const clone = (url.searchParams.get("clone") || "").trim();
  const targets = (url.searchParams.get("targets") || "")
    .split(",").map((t) => t.trim()).filter(Boolean).slice(0, 5);
  if (!TOKEN.test(clone) || !/[A-Za-z]/.test(clone) || clone.replace(/[^A-Za-z0-9]/g, "").length < 3) {
    return { error: "Clone name too short or unusual to search" };
  }
  if (!targets.length || !targets.every((t) => TOKEN.test(t))) return { error: "Bad targets" };
  const query = `"${clone}" AND (${targets.map((t) => `"${t}"`).join(" OR ")})`;
  const u = `${EPMC}?query=${encodeURIComponent(query)}&format=json&pageSize=1&resultType=idlist`;
  const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!r.ok) throw new Error(`epmc ${r.status}`);
  const data = await r.json();
  return {
    clone,
    query,
    count: Number(data.hitCount) || 0,
    url: `https://europepmc.org/search?query=${encodeURIComponent(query)}`,
  };
}

export async function search(q, vendor = "", species = "") {
  // The first word may be a gene name or synonym ("CD45" or "CD45 HI30").
  const [first, ...rest] = q.split(" ");
  const gene = await lookupGene(first).catch(() => null);
  const single = rest.length === 0;

  // One word: every registry entry whose target is that name, the gene symbol
  // or a synonym. Several words, or a clone/catalog number: keyword search.
  const names = single ? targetNames(first, gene) : [];
  const byTarget = names.length ? fetchByTarget(names, vendor, species) : null;

  const terms = [];
  if (!vendor) {
    terms.push(q);
    if (gene && gene.symbol.toLowerCase() !== first.toLowerCase()) terms.push([gene.symbol, ...rest].join(" "));
  }
  // Either source may time out; keep whatever answered and fail only if none did.
  const [t, ...pages] = await Promise.all([
    byTarget ? byTarget.catch(() => null) : Promise.resolve(null),
    ...terms.map((term) => fetchRegistry(term).catch(() => null)),
  ]);
  if (!t && pages.every((p) => !p)) throw new Error("registry unavailable");
  const partial = Boolean((byTarget && !t) || pages.some((p) => !p));

  const seen = new Map();
  const totals = {};
  const add = (items) => { for (const item of items) if (!seen.has(item.abId)) seen.set(item.abId, slim(item)); };
  let target = null;
  if (t) {
    target = { total: t.total, fetched: t.items.length, vendor: vendor || null };
    add(t.items);
  }
  pages.forEach((page, i) => {
    if (!page) return;
    totals[terms[i]] = page.totalElements ?? page.items.length;
    add(page.items);
  });

  const items = [...seen.values()].sort((a, b) => b.citations - a.citations);
  const truncated =
    Object.values(totals).some((n) => n > PAGE_SIZE) || Boolean(target && target.total > target.fetched);
  return {
    query: q,
    gene,
    searched: terms,
    totals,
    target,
    // Further slices for the page to fetch one by one from /api/antibodies/chunk.
    more: t ? t.more : [],
    partial,
    truncated,
    items,
    sources: {
      registry: "https://www.antibodyregistry.org",
      hpa: "https://www.proteinatlas.org",
    },
  };
}

// Target spellings to match: as typed, the gene symbol and its synonyms, each
// also with the species prefix vendors often put in the target ("Human CD4").
function targetNames(first, gene) {
  const base = [first, ...(gene ? [gene.symbol, ...gene.synonyms] : [])]
    .map((n) => n.trim())
    .filter((n) => n.length >= 2);
  const uniq = [...new Map(base.map((n) => [n.toLowerCase(), n])).values()].slice(0, 12);
  return uniq.flatMap((n) => [n, `Human ${n}`, `Mouse ${n}`, `Rat ${n}`]);
}

// Entries for these targets, sorted by citations.
// With a vendor ("load all from vendor"): up to FILTER_PAGES pages of it here.
// Without: page 1 here, and a list of the remaining slices (further pages, and
// the top page for each major vendor) that the page loads one at a time, so
// results show quickly and one slow request never blocks the rest.
function filterBody(names, page, vendor, species = "") {
  return {
    isAnyOf: [{ key: "ab_target", value: names }],
    ...(vendor ? { equals: [{ key: "vendor", value: vendor }] } : {}),
    ...(species ? { contains: [{ key: "species", value: species }] } : {}),
    sortOn: [{ key: "citation", sortorder: "desc" }],
    size: FILTER_PAGE,
    page,
  };
}

async function fetchByTarget(names, vendor, species = "") {
  const first = await postFilter(filterBody(names, 1, vendor, species)).catch(() => postFilter(filterBody(names, 1, vendor, species)));
  const total = Number(first.totalElements) || first.items.length;
  const n = Math.min(FILTER_PAGES, Math.ceil(total / FILTER_PAGE));
  if (vendor) {
    const pages = [];
    for (let p = 2; p <= n; p++) pages.push(p);
    const more = await pool(pages, 3, (p) => postFilter(filterBody(names, p, vendor, species)).catch(() => ({ items: [] })));
    return { total, items: [first, ...more].flatMap((x) => x.items), more: [] };
  }
  const more = [];
  for (let p = 2; p <= n; p++) more.push({ page: p });
  if (total > FILTER_PAGES * FILTER_PAGE) MAJOR_VENDORS.forEach((v) => more.push({ vendor: v }));
  return { total, items: first.items, more };
}

// One slice of a one-word search: ?q=CD4&page=2, or ?q=CD4&vendor=Abcam.
async function chunkQuery(url) {
  const q = (url.searchParams.get("q") || "").trim();
  const page = Number(url.searchParams.get("page") || 1);
  const vendor = (url.searchParams.get("vendor") || "").trim();
  const species = speciesParam(url);
  if (species === undefined) return { error: "Unknown species" };
  if (!q || q.includes(" ") || q.length > 40) return { error: "Bad q" };
  if (!Number.isInteger(page) || page < 1 || page > FILTER_PAGES) return { error: "Bad page" };
  if (vendor && !MAJOR_VENDORS.includes(vendor)) return { error: "Unknown vendor" };
  const gene = await lookupGene(q).catch(() => null);
  const res = await postFilter(filterBody(targetNames(q, gene), page, vendor, species));
  return { items: res.items.map(slim) };
}

async function pool(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

async function postFilter(body) {
  const r = await fetch(REGISTRY_FILTER, {
    method: "POST",
    headers: { "User-Agent": UA, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`registry filter ${r.status}`);
  const data = await r.json();
  return { totalElements: data.totalElements, items: Array.isArray(data.items) ? data.items : [] };
}

async function fetchRegistry(term) {
  const u = `${REGISTRY}?q=${encodeURIComponent(term)}&page=1&size=${PAGE_SIZE}`;
  const r = await fetch(u, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`registry ${r.status}`);
  const data = await r.json();
  return { totalElements: data.totalElements, items: Array.isArray(data.items) ? data.items : [] };
}

// HPA consensus tissues with RNA levels (nTPM) in the search API.
const TISSUES = (
  "adipose_tissue adrenal_gland amygdala appendix basal_ganglia bone_marrow breast cerebellum " +
  "cerebral_cortex cervix choroid_plexus colon duodenum endometrium_1 epididymis esophagus " +
  "fallopian_tube gallbladder heart_muscle hippocampal_formation hypothalamus kidney liver lung " +
  "lymph_node midbrain ovary pancreas parathyroid_gland pituitary_gland placenta prostate rectum " +
  "retina salivary_gland seminal_vesicle skeletal_muscle skin_1 small_intestine smooth_muscle " +
  "spinal_cord spleen stomach_1 testis thymus thyroid_gland tongue tonsil urinary_bladder vagina"
).split(" ");

// Human gene whose symbol or synonym matches the query exactly (case-insensitive).
async function lookupGene(q) {
  if (!/^[A-Za-z0-9-]{2,20}$/.test(q)) return null;
  const cols = ["g", "gs", "eg", "up", "ab", "relih", "rnats", ...TISSUES.map((t) => `t_RNA_${t}`)].join(",");
  const u = `${HPA}?search=${encodeURIComponent(q)}&format=json&columns=${cols}&compress=no`;
  const r = await fetch(u, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
    cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }, // Cloudflare caches the HPA answer
  });
  if (!r.ok) return null;
  const rows = await r.json();
  if (!Array.isArray(rows)) return null;
  const want = q.toLowerCase();
  const row =
    rows.find((x) => (x.Gene || "").toLowerCase() === want) ||
    rows.find((x) => (x["Gene synonym"] || []).some((s) => s.toLowerCase() === want));
  if (!row) return null;
  const ens = row.Ensembl;
  return {
    symbol: row.Gene,
    synonyms: row["Gene synonym"] || [],
    uniprot: row.Uniprot || [],
    ensembl: ens || null,
    hpa_antibodies: row.Antibody || [],
    hpa_ihc_reliability: row["Reliability (IH)"] || null,
    hpa_url: ens ? `https://www.proteinatlas.org/${ens}-${row.Gene}` : null,
    rna_tissue_specificity: row["RNA tissue specificity"] || null,
    tissue_rna: tissueRna(row),
  };
}

// GET /api/gene?q=SYMBOL: the HPA gene record alone (symbol, synonyms, tissue RNA),
// used by the panel builder for entries saved before it stored expression.
async function geneQuery(url) {
  const q = (url.searchParams.get("q") || "").trim();
  if (!/^[A-Za-z0-9-]{2,20}$/.test(q)) return { error: "Give one gene symbol.", status: 400 };
  return { gene: await lookupGene(q) };
}

// [{tissue, ntpm}] from "Tissue RNA - lymph node [nTPM]" fields, highest first.
function tissueRna(row) {
  const out = [];
  for (const [k, v] of Object.entries(row)) {
    const m = k.match(/^Tissue RNA - (.+) \[nTPM\]$/);
    const n = parseFloat(v);
    if (m && Number.isFinite(n)) out.push({ tissue: m[1].replace(/ \d+$/, ""), ntpm: n });
  }
  return out.sort((a, b) => b.ntpm - a.ntpm);
}

function slim(x) {
  const clone = (x.cloneId || "").replace(/^clone\s*/i, "").trim();
  return {
    rrid: `AB_${x.accession ?? x.abId}`,
    target: x.abTarget || "",
    name: x.abName || "",
    vendor: x.vendorName || "",
    catalog: x.catalogNum || "",
    clone: clone || "",
    clonality: (x.clonality || "").toLowerCase(),
    host: cap((x.sourceOrganism || "").trim()),
    // Registry writes e.g. "Green dyes (eg FITC); FITC"; keep the specific label.
    conjugate: (x.productConjugate || "").split(";").pop().trim(),
    applications: Array.isArray(x.applications) ? x.applications : [],
    reactivity: Array.isArray(x.targetSpecies) ? x.targetSpecies.map((t) => cap(String(t).trim())).filter(Boolean) : [],
    citations: Number(x.numOfCitation) || 0,
    discontinued: Boolean(x.discDate),
    product_url: productUrl(x.url),
  };
}

// Registry "url" is usually empty or just the vendor home page; keep it only
// when it points at a specific page.
function productUrl(u) {
  if (!u) return null;
  try {
    const p = new URL(/^https?:/i.test(u) ? u : `https://${u}`);
    return p.pathname.length > 1 || p.search ? p.href : null;
  } catch {
    return null;
  }
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : "";
}

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}
