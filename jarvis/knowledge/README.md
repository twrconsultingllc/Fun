# J.A.R.V.I.S. knowledge pack

`pack.json` holds the stable, public facts that `jarvis-test.html` answers from when you ask
"tell me about Peru", "how far is Mars", "tell me about gold" or "tell me about the Mark 42"
(Session 13 of `jarvis/build-plan.html`). The page fetches it from this site the first time you
ask, and copies every record into its own IndexedDB database (`jarvis-test`, table `pack`),
through `save()`, where `fits()` checks each one. The page's CSP (`connect-src 'self'`) is
unchanged: nothing comes from another host.

`build.mjs` makes it. Nothing in `pack.json` is typed by hand except the suit lines.

## Sources

| What | Source | Licence |
| --- | --- | --- |
| 8 planets and Pluto: distance from the Sun, size, day, year, gravity, temperature, rings | NASA NSSDCA Planetary Fact Sheet (metric), `https://nssdc.gsfc.nasa.gov/planetary/factsheet/` | US government work, public domain |
| 21 major moons: radius, density | NASA JPL Solar System Dynamics, satellite physical parameters, `https://ssd.jpl.nasa.gov/sats/phys_par/` | US government work, public domain |
| 25 well-known stars: constellation, spectral type, magnitude, distance where the parallax is good enough | Yale Bright Star Catalogue, 5th revised edition (Hoffleit and Warren 1991), from CDS, `https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz` | free to use, with credit to the authors and CDS |
| 22 space missions: launch date | NASA NSSDCA Master Catalog, one page per mission (Europa Clipper is left out: the catalogue has no record for it yet) | US government work, public domain |
| All 118 elements | PubChem Periodic Table (NIH), `https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/JSON` | US government work, public domain |
| 76 countries (every country on the globe except England and Scotland): capital, region, area, highest point, flag | CIA World Factbook, last archived copy in `factbook/factbook.json`, pinned to commit `144d6977b2b01ac1cbd220de754c0a005616760b` | public domain |
| 13 Iron Man suits, a line or two each | Hand-written in `suits.json` | fan knowledge, not an official source |

The CIA closed the World Factbook in February 2026, so its last archived copy is the source. The
missions' destinations and agencies, and which catalogue number belongs to which star, are listed in
`build.mjs`; the build checks each against the source (a star's catalogue name, a mission page naming
the craft and a launch year matching its ID) and stops if one doesn't match.

**Stable facts only.** No population, GDP, leaders, currencies, counts of moons, or anything marked
as an estimate: those go stale without anyone noticing. `checkPack()` in `build.mjs` refuses a pack
with a field or a sentence like that, the page's `fits()` refuses such a record, and
`tests/jarvis-test.dom.test.mjs` fails if either lets one through. **No Wikipedia text**, because
its licence needs attribution on every reuse.

## Building it

The claude.ai/code containers can't reach NASA, JPL, CDS or PubChem (their proxy refuses them), so
the real build runs somewhere else. Either:

- **From the Actions tab:** open "J.A.R.V.I.S. knowledge pack" and press **Run workflow**. It builds
  from the sample documents first, then from the real sources, checks the result and commits
  `pack.json` only if the facts changed. GitHub Pages then redeploys with it.
- **From the Codespace:**

```bash
cd jarvis/knowledge
node build.mjs
node build.mjs --check=pack.json
```

Then commit `pack.json`.

To try the parsers without the internet, build from the sample documents in
`tests/fixtures/jarvis-knowledge/` (this writes nothing unless you give `--out`):

```bash
node build.mjs --dry-run
```

The samples are real data where it was reachable: trimmed copies of the archived Factbook profiles,
real catalogue lines for the 25 stars, and PubChem's table as published in the `pubchem-elements`
npm package. The NASA and JPL pages are laid out like the real pages with their values, and the
mission pages are minimal stand-ins; the real build will say exactly which page didn't parse if
NASA's layout differs. The suite builds its pack from these samples, so the page is tested
without `pack.json`.

No dependencies: Node 22's own `fetch` and `zlib`.
