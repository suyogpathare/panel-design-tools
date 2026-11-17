# Builds public/data/panels-human.json and panels-mouse.json for PanelScout:
# which commercial imaging-based spatial transcriptomics panels contain which genes,
# from the vendors' own published gene lists, plus HGNC / MGI symbol aliases.
#
# Run (needs uv, https://docs.astral.sh/uv/):
#   uv run --no-project --with openpyxl python scripts/build-panels.py
#
# Downloads are cached in .cache/panels/ (gitignored). Delete it to refresh.
import datetime, json, os, re, urllib.request
import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "panels")
OUT = os.path.join(ROOT, "public", "data")
os.makedirs(CACHE, exist_ok=True)

X10 = "https://cdn.10xgenomics.com/raw/upload"
XPAGE_V1 = "https://www.10xgenomics.com/support/software/xenium-panel-designer/latest/tutorials/pre-designed-xenium-v1"
XPAGE_5K = "https://www.10xgenomics.com/support/software/xenium-panel-designer/latest/analysis/pre-designed-panels/pre-designed-xenium-prime-5k"
BRU = "https://brukerspatialbiology.com"

XENIUM = [
    # (id, species, file url, info page)
    ("xenium-5k-human", "human", f"{X10}/v1715644508/software-support/Xenium-panels/5K_panel_files/xenium_human_5k_gene_expression.json", XPAGE_5K),
    ("xenium-multi-human", "human", f"{X10}/v1694725993/software-support/Xenium-panels/gene_panel_json_files/human_multi_gene_expression.json", XPAGE_V1),
    ("xenium-io-human", "human", f"{X10}/v1707847003/software-support/Xenium-panels/gene_panel_json_files/xenium_human_immuno_oncology_profiling.json", XPAGE_V1),
    ("xenium-brain-human", "human", f"{X10}/v1718660433/software-support/Xenium-panels/gene_panel_json_files/xenium_human_brain_gene_expression.json", XPAGE_V1),
    ("xenium-breast-human", "human", f"{X10}/v1718660433/software-support/Xenium-panels/gene_panel_json_files/xenium_human_breast_gene_expression.json", XPAGE_V1),
    ("xenium-colon-human", "human", f"{X10}/v1694725992/software-support/Xenium-panels/gene_panel_json_files/human_colon_gene_expression.json", XPAGE_V1),
    ("xenium-lung-human", "human", f"{X10}/v1697489942/software-support/Xenium-panels/gene_panel_json_files/human_lung_gene_expression.json", XPAGE_V1),
    ("xenium-skin-human", "human", f"{X10}/v1694725994/software-support/Xenium-panels/gene_panel_json_files/human_skin_gene_expression.json", XPAGE_V1),
    ("xenium-5k-mouse", "mouse", f"{X10}/v1715203508/software-support/Xenium-panels/5K_panel_files/xenium_mouse_5k_gene_expression.json", XPAGE_5K),
    ("xenium-multi-mouse", "mouse", f"{X10}/v1694725994/software-support/Xenium-panels/gene_panel_json_files/mouse_multi_gene_expression.json", XPAGE_V1),
    ("xenium-brain-mouse", "mouse", f"{X10}/v1694725994/software-support/Xenium-panels/gene_panel_json_files/mouse_brain_gene_expression.json", XPAGE_V1),
]

COSMX = [
    # (id, species, short name, file url, info page)
    ("cosmx-wtx-human", "human", "CosMx Human Whole Transcriptome (WTX)",
     f"{BRU}/wp-content/uploads/2025/05/LBL-11220-01_CosMx_Human_Whole_Transcriptome_WTX_GeneList.xlsx",
     f"{BRU}/resources/cosmx-human-whole-transcriptome-wtx-genelist/"),
    ("cosmx-6k-human", "human", "CosMx Human 6K Discovery",
     f"{BRU}/wp-content/uploads/2023/06/LBL-11190-04-Human-6k-Discovery-Gene-List.xlsx",
     f"{BRU}/resources/cosmx-human-6k-discovery-panel-gene-list/"),
    ("cosmx-ucc-human", "human", "CosMx Human Universal Cell Characterization (1K)",
     f"{BRU}/wp-content/uploads/2022/12/LBL-11178-04-Human-Universal-Cell-Characterization-Panel-Gene-Target-List.xlsx",
     f"{BRU}/resources/cosmx-smi-universal-cell-characterization-panel-gene-list/"),
    ("cosmx-io-human", "human", "CosMx Human Immuno-Oncology RNA (100)",
     f"{BRU}/wp-content/uploads/2023/10/LBL-11180-04-Human-IO-RNA-Panel-Gene-Target-List.xlsx",
     f"{BRU}/resources/cosmx-immuno-oncology-rna-panel-gene-list/"),
    ("cosmx-ucc-mouse", "mouse", "CosMx Mouse Universal Cell Characterization (1K)",
     f"{BRU}/wp-content/uploads/2023/10/LBL-11176-04-Mouse-Universal-Cell-Characterization-Gene-List.xlsx",
     f"{BRU}/resources/cosmx-mouse-universal-cell-characterization-rna-panel-gene-list/"),
    ("cosmx-neuro-mouse", "mouse", "CosMx Mouse Neuroscience (1K)",
     f"{BRU}/wp-content/uploads/2022/11/LBL-11179-05-Mouse-Neuroscience-Panel-Gene-List.xlsx",
     f"{BRU}/resources/cosmx-smi-mouse-neuroscience-panel-gene-list/"),
]

# Lab shorthand that HGNC/MGI don't list, or list ambiguously. The first symbol is the usual meaning.
COMMON = {
    "human": {"KI67": ["MKI67"], "PD1": ["PDCD1"], "PD-1": ["PDCD1"], "CD3": ["CD3E", "CD3D", "CD3G"],
              "CD8": ["CD8A", "CD8B"], "CD16": ["FCGR3A", "FCGR3B"], "CD32": ["FCGR2A", "FCGR2B"],
              "HLA-DR": ["HLA-DRA", "HLA-DRB1"], "SMA": ["ACTA2"], "ASMA": ["ACTA2"], "ALPHA-SMA": ["ACTA2"],
              "ECAD": ["CDH1"], "E-CADHERIN": ["CDH1"], "PANCK": ["KRT8", "KRT18", "KRT19"]},
    "mouse": {"KI67": ["Mki67"], "PD1": ["Pdcd1"], "PD-1": ["Pdcd1"], "CD3": ["Cd3e", "Cd3d", "Cd3g"],
              "CD8": ["Cd8a", "Cd8b1"], "CD45": ["Ptprc"], "F4/80": ["Adgre1"], "SMA": ["Acta2"],
              "ECAD": ["Cdh1"], "E-CADHERIN": ["Cdh1"]},
}

HGNC = "https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/hgnc_complete_set.txt"
MGI = "https://www.informatics.jax.org/downloads/reports/MRK_List2.rpt"


def fetch(url):
    path = os.path.join(CACHE, re.sub(r"[^A-Za-z0-9._-]", "_", url.split("/")[-1]))
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (PanelScout build script)"})
        with urllib.request.urlopen(req, timeout=120) as r, open(path, "wb") as f:
            f.write(r.read())
    return path


def xenium(pid, species, url, page):
    d = json.load(open(fetch(url)))["payload"]
    p = d["panel"]
    genes = [t["type"]["data"]["name"] for t in d["targets"] if t["type"]["descriptor"] == "gene"]
    name = p["identity"]["name"]
    if not name.startswith("Xenium"):
        name = "Xenium " + name
    name = name.replace(" Gene Expression", "").replace(" Panel", "")
    return {"id": pid, "species": species, "vendor": "10x Genomics", "platform": "Xenium",
            "name": name, "genes": genes, "addon": [], "source": url, "page": page,
            "version": p["identity"].get("version", "")}


def cosmx(pid, species, name, url, page):
    wb = openpyxl.load_workbook(fetch(url), read_only=True)
    rows = list(wb["Gene and Probe Details"].iter_rows(values_only=True))
    head = [str(c or "").strip() for c in rows[1]]
    i_name = head.index("Display Name")
    i_type = head.index("Panel Type") if "Panel Type" in head else None
    genes, addon = [], []
    for r in rows[2:]:
        g = r[i_name]
        if g is None:
            continue
        g = str(g).strip()
        # Skip negative-control probes, section labels and spreadsheet formulas.
        if not g or g.startswith("=") or re.match(r"(?i)^(negative|negprb|systemcontrol|falsecode)", g):
            continue
        genes.append(g)
        if i_type is not None and str(r[i_type] or "").strip().lower() == "add-on":
            addon.append(g)
    # The whole-transcriptome list names protein-coding genes left out on purpose, with the reason.
    excluded = {}
    if "Known Missing Targets" in wb.sheetnames:
        for r in list(wb["Known Missing Targets"].iter_rows(values_only=True))[2:]:
            if r and r[0] and r[1]:
                excluded[str(r[0]).strip()] = str(r[1]).strip()
    return {"id": pid, "species": species, "vendor": "Bruker Spatial Biology", "platform": "CosMx",
            "name": name, "genes": genes, "addon": addon, "excluded": excluded,
            "source": url, "page": page, "version": ""}


def hgnc_aliases():
    """alias or previous symbol (upper case) -> list of current approved symbols."""
    off, alias = {}, {}
    with open(fetch(HGNC), encoding="utf-8") as f:
        head = f.readline().rstrip("\n").split("\t")
        ix = {k: i for i, k in enumerate(head)}
        for line in f:
            c = line.rstrip("\n").split("\t")
            if c[ix["status"]] != "Approved":
                continue
            sym = c[ix["symbol"]]
            off[sym.upper()] = sym
            for col in ("alias_symbol", "prev_symbol"):
                for a in c[ix[col]].strip('"').split("|"):
                    a = a.strip()
                    if a:
                        alias.setdefault(a.upper(), set()).add(sym)
    return off, alias


def mgi_aliases():
    off, alias = {}, {}
    with open(fetch(MGI), encoding="utf-8") as f:
        head = f.readline().rstrip("\n").split("\t")
        ix = {k: i for i, k in enumerate(head)}
        syn = [k for k in head if k.startswith("Marker Synonyms")][0]
        for line in f:
            c = line.rstrip("\n").split("\t")
            if len(c) < len(head) or c[ix["Status"]] != "O" or c[ix["Marker Type"]] != "Gene":
                continue
            sym = c[ix["Marker Symbol"]]
            off[sym.upper()] = sym
            for a in c[ix[syn]].split("|"):
                a = a.strip()
                if a:
                    alias.setdefault(a.upper(), set()).add(sym)
    return off, alias


def resolve(name, official, alias):
    """Vendor name -> current official symbol, or None."""
    u = name.upper()
    if u in official:
        return official[u]
    if u in alias and len(alias[u]) == 1:
        return next(iter(alias[u]))
    return None


def expand(probe, official, alias):
    """A probe that detects several paralogs, written "CCL3/L1/L3", "HBA1/2" or
    "IFNA4/10/17", -> its genes. Each suffix replaces the end of the first name;
    the longest prefix that gives a real gene wins. Returns [] if any part fails."""
    parts = probe.split("/")
    base = parts[0]
    first = resolve(base, official, alias)
    if not first:
        return []
    out = [first]
    for s in parts[1:]:
        hit = None
        for k in range(len(base), 0, -1):
            hit = resolve(base[:k] + s, official, alias)
            if hit:
                break
        if not hit:
            return []
        out.append(hit)
    return out


def build(species, panels, official, alias):
    # Map each panel gene to the current official symbol where the vendor used an older name.
    renamed = {}
    for p in panels:
        fixed, addon, p["shared"] = [], [], {}
        for g in p["genes"]:
            genes = [resolve(g, official, alias)] if "/" not in g else expand(g, official, alias)
            if not genes or not genes[0]:
                genes = [g]  # keep the vendor's name, e.g. "HLA-DRB", "MHC I"
            elif "/" in g:
                for x in genes:
                    p["shared"][x] = g
            elif genes[0] != g:
                renamed.setdefault(genes[0], set()).add(g)
            fixed += genes
            if g in p["addon"]:
                addon += genes
        p["addon"] = addon
        p["targets"] = len(set(p["genes"]))  # the vendor's own count, before shared probes are split
        p["genes"] = fixed
    universe = sorted({g for p in panels for g in p["genes"]})
    index = {g: i for i, g in enumerate(universe)}
    out_alias = {}
    for a, syms in alias.items():
        if a in official:  # an approved symbol always wins over someone else's alias
            continue
        hits = sorted(s for s in syms if s in index)
        if hits:
            out_alias[a] = hits
    for new, olds in renamed.items():
        for o in olds:
            out_alias.setdefault(o.upper(), [new])
    for a, syms in COMMON[species].items():
        hits = [x for x in syms if x in index]
        if hits:
            rest = [x for x in out_alias.get(a, []) if x not in hits]
            out_alias[a] = hits + rest
    return {
        "species": species,
        "built": datetime.date.today().isoformat(),
        "genes": universe,
        "panels": [{
            "id": p["id"], "vendor": p["vendor"], "platform": p["platform"], "name": p["name"],
            "n": len(set(p["genes"])), "targets": p["targets"], "source": p["source"], "page": p["page"], "version": p["version"],
            "g": sorted({index[g] for g in p["genes"]}),
            "addon": sorted({index[g] for g in p["addon"]}),
            # gene index -> the multi-gene probe that detects it (paralogs it cannot be told apart from)
            "shared": {str(index[g]): probe for g, probe in sorted(p["shared"].items())},
            "excluded": p.get("excluded", {}),
        } for p in panels],
        "alias": out_alias,
    }


def main():
    panels = [xenium(*x) for x in XENIUM] + [cosmx(*c) for c in COSMX]
    for species, (official, alias) in (("human", hgnc_aliases()), ("mouse", mgi_aliases())):
        sp = [p for p in panels if p["species"] == species]
        data = build(species, sp, official, alias)
        # Only ship the list of all official symbols as a compact set for "unknown gene" checks.
        data["known"] = sorted(official.values())
        path = os.path.join(OUT, f"panels-{species}.json")
        with open(path, "w") as f:
            json.dump(data, f, separators=(",", ":"))
        print(f"{species}: {len(sp)} panels, {len(data['genes'])} genes, "
              f"{len(data['alias'])} aliases, {os.path.getsize(path) / 1e6:.2f} MB")
        for p in data["panels"]:
            print(f"  {p['name']}: {p['n']} genes ({len(p['addon'])} add-on)")


main()
