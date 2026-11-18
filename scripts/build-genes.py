# Builds public/data/genes-human.json and genes-mouse.json for PanelScout: current
# gene symbols and their aliases/previous symbols, from HGNC (human) and MGI (mouse).
# PanelScout uses them to read the user's gene list and the panel files the user
# loads from the vendors; no vendor panel content is built into the site.
#
# Run:  python3 scripts/build-genes.py
# Downloads are cached in .cache/genes/ (gitignored). Delete it to refresh.
import datetime, json, os, re, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache", "genes")
OUT = os.path.join(ROOT, "public", "data")
os.makedirs(CACHE, exist_ok=True)

HGNC = "https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/hgnc_complete_set.txt"
MGI = "https://www.informatics.jax.org/downloads/reports/MRK_List2.rpt"

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


def fetch(url):
    path = os.path.join(CACHE, re.sub(r"[^A-Za-z0-9._-]", "_", url.split("/")[-1]))
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers={"User-Agent": "PanelScout gene-symbol build"})
        with urllib.request.urlopen(req, timeout=120) as r, open(path, "wb") as f:
            f.write(r.read())
    return path


def hgnc():
    """official symbols, and alias or previous symbol (upper case) -> set of current symbols."""
    off, alias = [], {}
    with open(fetch(HGNC), encoding="utf-8") as f:
        head = f.readline().rstrip("\n").split("\t")
        ix = {k: i for i, k in enumerate(head)}
        for line in f:
            c = line.rstrip("\n").split("\t")
            if c[ix["status"]] != "Approved":
                continue
            sym = c[ix["symbol"]]
            off.append(sym)
            for col in ("alias_symbol", "prev_symbol"):
                for a in c[ix[col]].strip('"').split("|"):
                    if a.strip():
                        alias.setdefault(a.strip().upper(), set()).add(sym)
    return off, alias


def mgi():
    off, alias = [], {}
    with open(fetch(MGI), encoding="utf-8") as f:
        head = f.readline().rstrip("\n").split("\t")
        ix = {k: i for i, k in enumerate(head)}
        syn = [k for k in head if k.startswith("Marker Synonyms")][0]
        for line in f:
            c = line.rstrip("\n").split("\t")
            if len(c) < len(head) or c[ix["Status"]] != "O" or c[ix["Marker Type"]] != "Gene":
                continue
            sym = c[ix["Marker Symbol"]]
            off.append(sym)
            for a in c[ix[syn]].split("|"):
                if a.strip():
                    alias.setdefault(a.strip().upper(), set()).add(sym)
    return off, alias


def main():
    for species, (off, alias) in (("human", hgnc()), ("mouse", mgi())):
        official = {s.upper() for s in off}
        out_alias = {a: sorted(s) for a, s in alias.items() if a not in official}  # an approved symbol wins
        for a, syms in COMMON[species].items():
            out_alias[a] = syms + [x for x in out_alias.get(a, []) if x not in syms]
        data = {"species": species, "built": datetime.date.today().isoformat(),
                "source": "HGNC (genenames.org)" if species == "human" else "MGI (informatics.jax.org)",
                "genes": sorted(off), "alias": out_alias}
        path = os.path.join(OUT, f"genes-{species}.json")
        with open(path, "w") as f:
            json.dump(data, f, separators=(",", ":"))
        print(f"{species}: {len(off)} symbols, {len(out_alias)} aliases, {os.path.getsize(path) / 1e6:.2f} MB")


main()
