# Panel design tools: AbScout, PanelScout and Methods Writer

[![DOI](https://zenodo.org/badge/1462079432.svg)](https://doi.org/10.5281/zenodo.24326636)

Free web tools for designing spatial biology panels. Live at
[suyogpathare.com](https://suyogpathare.com/#tools).

Scientific design and validation by Suyog Pathare.

- **[AbScout](https://suyogpathare.com/abscout/)**: antibody search and
  panel builder for multiplex tissue imaging. It searches the Antibody
  Registry for a target and ranks the results by use in HuBMAP Organ Mapping
  Antibody Panels (OMAPs), knockout-based characterization by YCharOS,
  citations and recorded reactivity. The panel builder suggests one antibody
  per target for the chosen platform (indirect IF, cyclic IF, PhenoCycler,
  IMC/MIBI), flags host and fluorophore clashes and antibodies that failed a
  knockout test, assigns the brightest channels to the targets with the lowest
  RNA in the chosen tissue (Human Protein Atlas), and estimates bleed-through
  between dyes imaged together from FPbase spectra. A validation record keeps
  the specificity evidence for each panel antibody under the five strategies
  of the International Working Group for Antibody Validation (Uhlén et al.,
  Nature Methods 2016), adds published knockout and OMAP records, and drafts
  text for the authentication of key resources in grant applications. It
  records what the user enters and never declares an antibody validated.
- **[PanelScout](https://suyogpathare.com/panelscout/)**: paste a gene list and
  see how much of it each imaging spatial transcriptomics panel covers. It
  hosts no vendor panel lists: you download the panel files from the vendors
  (10x Genomics Xenium JSON, Bruker CosMx Excel) or use any CSV/TXT gene list,
  and the page reads them in your browser. Aliases and common shorthand are
  resolved through HGNC (human) and MGI (mouse).
- **[Methods Writer](https://suyogpathare.com/methods/)**: write the methods
  section and channel metadata for a multiplex tissue imaging study. The form
  follows the MITI reporting guidelines (Schapiro et al., Nature Methods 2022)
  for specimen preparation, staining, imaging and image processing, imports
  antibodies from an AbScout panel, and exports draft methods paragraphs, a
  MITI channel-level metadata CSV and a JSON record. It lists the MITI fields
  still empty; the text is built only from what the user enters, and nothing
  leaves the browser.

Not affiliated with or endorsed by any vendor or database named here.

## Data sources

| Source | Used for | Terms |
|---|---|---|
| [Antibody Registry](https://www.antibodyregistry.org/) | antibody records (queried live) | CC BY; vendor-supplied fields non-commercial only |
| [Human Protein Atlas](https://www.proteinatlas.org/) | gene records, tissue RNA (queried live) | CC BY 4.0 |
| [HuBMAP OMAPs](https://humanatlas.io/omap) | `public/data/omap.json` | CC BY 4.0 |
| [YCharOS](https://ycharos.com) via [Only Good Antibodies](https://onlygoodantibodies.co.uk) | knockout results (`public/data/ko.json`, built) | CC BY 4.0 |
| [FPbase](https://www.fpbase.org) | dye spectra (`public/data/dyes.json`, built) | CC BY-SA 4.0 |
| [HGNC](https://www.genenames.org), [MGI](https://www.informatics.jax.org) | gene symbols and aliases (`public/data/genes-*.json`, built) | see sites |
| [MITI](https://github.com/miti-consortium/MITI) | field definitions and value lists (Methods Writer) | MIT; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) |
| Vendor panel files | PanelScout | loaded by each user from the vendor; never hosted or redistributed here |

## Layout

- `public/abscout/index.html`, `public/panelscout/index.html`,
  `public/methods/index.html`: the tools
  (plain HTML and JavaScript, no build step).
- `src/worker.js`: Cloudflare Worker serving `public/` plus the API AbScout
  uses: `/api/antibodies?q=...[&vendor=...][&species=Human|Mouse|Rat]`,
  `/api/antibodies/chunk`, `/api/gene?q=SYMBOL`, `/api/papers`. Responses are
  cached at the edge for a day.
- `scripts/build-genes.py`: builds `public/data/genes-{human,mouse}.json`
  (HGNC and MGI symbols and aliases).
- `scripts/build-omap-index.mjs`, `scripts/build-ko-index.mjs`,
  `scripts/build-dyes.mjs`: build `omap.json`, `ko.json` and `dyes.json`.

## Run locally

```bash
python3 scripts/build-genes.py
node scripts/build-ko-index.mjs
node scripts/build-dyes.mjs
node scripts/build-omap-index.mjs   # optional; omap.json is included
npx wrangler dev
```

## Cite

See [`CITATION.cff`](CITATION.cff); GitHub shows a "Cite this repository"
button. Each release is archived on Zenodo with a DOI.

## License

MIT, see [`LICENSE`](LICENSE). Data from the sources above stays under its own
terms.
