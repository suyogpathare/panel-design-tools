# Panel design tools: AbScout and PanelScout

[![DOI](https://zenodo.org/badge/1462079432.svg)](https://doi.org/10.5281/zenodo.24326636)

Free web tools for designing spatial biology panels. Live at
[suyogpathare.com](https://suyogpathare.com/#tools).

Scientific design and validation by Suyog Pathare.

- **[AbScout](https://suyogpathare.com/abscout/)**: antibody search and
  panel builder for multiplex tissue imaging. It searches the Antibody
  Registry for a target and ranks the results by use in HuBMAP Organ Mapping
  Antibody Panels (OMAPs), citations and recorded reactivity. The panel
  builder suggests one antibody per target for the chosen platform (indirect
  IF, cyclic IF, PhenoCycler, IMC/MIBI), flags host and fluorophore clashes,
  and assigns the brightest channels to the targets with the lowest RNA in the
  chosen tissue (Human Protein Atlas).
- **[PanelScout](https://suyogpathare.com/panelscout/)**: paste a gene list and
  see how much of it each pre-designed 10x Genomics Xenium and Bruker CosMx
  panel covers. Aliases and common shorthand are resolved through HGNC (human)
  and MGI (mouse).

Not affiliated with or endorsed by 10x Genomics, Bruker, the Antibody
Registry, HuBMAP or the Human Protein Atlas.

## Data sources

| Source | Used for | Terms |
|---|---|---|
| [Antibody Registry](https://www.antibodyregistry.org/) | antibody records (queried live) | see site |
| [Human Protein Atlas](https://www.proteinatlas.org/) | gene records, tissue RNA (queried live) | CC BY-SA 4.0 |
| [HuBMAP OMAPs](https://humanatlas.io/omap) | `public/data/omap.json` | CC BY 4.0 |
| 10x Genomics Xenium and Bruker CosMx gene lists | PanelScout panels | vendor terms; downloaded by the build script, not included here |
| [HGNC](https://www.genenames.org/), [MGI](https://www.informatics.jax.org/) | symbols and aliases | see sites |

## Layout

- `public/abscout/index.html`, `public/panelscout/index.html`: the tools
  (plain HTML and JavaScript, no build step).
- `src/worker.js`: Cloudflare Worker serving `public/` plus the API AbScout
  uses: `/api/antibodies?q=...[&vendor=...][&species=Human|Mouse|Rat]`,
  `/api/antibodies/chunk`, `/api/gene?q=SYMBOL`, `/api/papers`. Responses are
  cached at the edge for a day.
- `scripts/build-panels.py`: builds `public/data/panels-{human,mouse}.json`
  from the vendors' published gene lists.
- `scripts/build-omap-index.mjs`: builds `public/data/omap.json`.

## Run locally

```bash
uv run --no-project --with openpyxl python scripts/build-panels.py
node scripts/build-omap-index.mjs   # optional; omap.json is included
npx wrangler dev
```

## Cite

See [`CITATION.cff`](CITATION.cff); GitHub shows a "Cite this repository"
button. Each release is archived on Zenodo with a DOI.

## License

MIT, see [`LICENSE`](LICENSE). Data from the sources above stays under its own
terms.
