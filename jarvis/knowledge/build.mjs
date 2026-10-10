#!/usr/bin/env node
/* J.A.R.V.I.S. knowledge pack — build script (Session 13 of jarvis/build-plan.html).
 *
 * Builds jarvis/knowledge/pack.json: stable, public facts that jarvis-test.html copies into its own
 * IndexedDB the first time you ask it about a country, a planet, a moon, a star, a space mission, an
 * element or an Iron Man suit. Every fact comes from a public-domain or free-to-use source listed in
 * SOURCES below, except the suit lines, which are hand-written fan knowledge in suits.json.
 *
 *   node build.mjs                          # fetch the real sources, check, write pack.json
 *   node build.mjs --dry-run                # build from tests/fixtures/jarvis-knowledge/, write nothing
 *   node build.mjs --dry-run --out=x.json   # the same, and write the result to x.json
 *   node build.mjs --check=pack.json        # check an existing pack without building one
 *
 * The real build needs the internet: the claude.ai/code containers can't reach NASA, JPL, CDS or
 * PubChem, so run it in the Codespace or from the "J.A.R.V.I.S. knowledge pack" workflow in the
 * Actions tab (.github/workflows/jarvis-knowledge.yml). See README.md in this folder.
 *
 * Stable facts only. Nothing that goes stale silently: no population, GDP, leaders, currencies or
 * counts of moons. checkPack() refuses a pack with a field or a sentence like that, the page's fits()
 * refuses such a record, and tests/jarvis-test.dom.test.mjs fails if either lets one through.
 * No Wikipedia text: its licence needs attribution on every reuse.
 *
 * pack.json is only rewritten when its records change, so a run that finds nothing new makes no
 * commit. No dependencies: Node 22's own fetch and zlib.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = new URL('./', import.meta.url);
const USER_AGENT = 'JarvisKnowledgePack/1.0 (builds a static fact file; +https://github.com/twrconsultingllc/Fun)';
const FETCH_TIMEOUT_MS = 30000;
export const PACK_FORMAT = 1;

// The CIA closed the World Factbook in February 2026. factbook/factbook.json kept its last copy of every
// country profile as JSON (public domain, like the Factbook itself). Pinned to one commit, so a rebuild reads
// exactly the same profiles until this line is changed on purpose.
export const FACTBOOK_SHA = '144d6977b2b01ac1cbd220de754c0a005616760b';

export const SOURCES = [
    { id: 'planets', name: 'NASA NSSDCA Planetary Fact Sheet (metric)', url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/', licence: 'US government work, public domain', used: 'planets and Pluto: distance from the Sun, size, day, year, gravity, temperature, rings' },
    { id: 'moons', name: 'NASA JPL Solar System Dynamics: planetary satellite physical parameters', url: 'https://ssd.jpl.nasa.gov/sats/phys_par/', licence: 'US government work, public domain', used: 'major moons: radius and density' },
    { id: 'stars', name: 'Yale Bright Star Catalogue, 5th revised edition (Hoffleit and Warren 1991), from CDS', url: 'https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz', licence: 'free to use; credit to the authors and CDS', used: 'well-known stars: constellation, spectral type, brightness, and distance where the parallax is good enough' },
    { id: 'missions', name: 'NASA NSSDCA Master Catalog', url: 'https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=', licence: 'US government work, public domain', used: 'space missions: launch date (destination and agency are listed in build.mjs)' },
    { id: 'elements', name: 'PubChem Periodic Table (NIH)', url: 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/JSON', licence: 'US government work, public domain', used: 'all 118 elements: symbol, number, mass, state, family, melting and boiling points, year found' },
    { id: 'countries', name: 'CIA World Factbook, last archived copy (factbook/factbook.json)', url: `https://raw.githubusercontent.com/factbook/factbook.json/${FACTBOOK_SHA}/`, licence: 'public domain', used: 'countries on the globe: capital, region, area, highest point, flag' },
    { id: 'suits', name: 'Hand-written for this site (suits.json)', url: '', licence: 'fan knowledge, not an official source', used: 'Iron Man suits: a line or two each' }
];

/* ---------- What a record may hold: the same rules as fits('pack', …) in jarvis-test.html ---------- */

// s: short text, t: a sentence or two, n: a number, n?: a number or null, i: a whole number, b: true or false,
// T: exactly true, a: a list of short text, d: [year, month, day].
export const PACK_FIELDS = {
    country: { name: 's', capital: 'a', region: 's', area: 'n', high: 's', high_m: 'n', flag: 't', colours: 'a' },
    planet: { name: 's', sun: 'n', peri: 'n', aph: 'n', size: 'n', day: 'n', year: 'n', gravity: 'n', temp: 'n', rings: 'b', dwarf: 'b' },
    moon: { name: 's', planet: 's', radius: 'n', density: 'n' },
    star: { name: 's', constellation: 's', spectral: 's', mag: 'n', ly: 'n?' },
    mission: { name: 's', launch: 'd', target: 's', agency: 's' },
    element: { name: 's', symbol: 's', n: 'i', mass: 'n', state: 's', family: 's', melt: 'n?', boil: 'n?', found: 'i' },
    suit: { name: 's', aka: 'a', film: 's', line: 't', fan: 'T' }
};
// Things that go stale without anyone noticing. A field named like this, or a sentence saying it, fails the build.
export const STALE_KEY = /popul|gdp|moons|leader|president|currency|econom|budget|debt|export|import|users|literacy|expectancy|census|inflation|unemploy/i;
export const STALE_TEXT = /\best\.|\b(?:population|populous|inhabitants|people live|residents|gdp|gross domestic|per capita|economy|unemployment|inflation|exchange rate|currency|budget|national debt|exports?|imports?|president|prime minister|chancellor|head of state|life expectancy|literacy|internet users|estimated?|estimates|as of|currently|number of moons|known moons)\b/i;
// The page's own test for personal text (PERSONAL in jarvis-test.html), copied so the build refuses anything the page
// would. The suite checks the two lists are the same.
export const PERSONAL = [
    ['an email address', /[^\s@]@[^\s@]+\.[a-z]{2,}/i],
    ['a phone or ID number', /(?:\+?\d[\s().-]*){7,}/],
    ['a long number', /\d{5,}/],
    ['a date', /\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b/],
    ['a street address', /\b\d{1,6}(?:\s+[a-z0-9.'-]+){1,4}\s+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|circle|cir|parkway|pkwy|place|pl|terrace|ter|highway|hwy|trail|trl)\b/i],
    ['a web address', /https?:\/\/|\bwww\.|[a-z0-9-]\.(?:com|org|net|edu|gov|io|co|us|uk)\b/i],
    ['something about you', /\bmy (?:name|full name|first name|last name|surname|nickname|address|street|zip|post ?code|town|city|phone|cell|mobile|number|email|e-?mail|birthday|birth ?date|date of birth|dob|age|password|passcode|pin|login|username|social security|ssn|credit card|debit card|card|account|bank|routing|licen[cs]e|passport|doctor|diagnosis|medication|medicine|condition|allerg(?:y|ies)|school|teacher|class|wife|husband|partner|girlfriend|boyfriend|son|daughter|kids?|children|mom|mum|mother|dad|father|brother|sister|boss|work|workplace|job|employer|salary|religion|church)\b|\bi(?:'m| am) \d{1,3}(?: years old)?\b|\bi live\b|\bi was born\b|\bcall me\b|\b(?:password|passcode|pin code|social security|credit card|ssn)\b/i]
];
const personal = (text) => { for (const [why, re] of PERSONAL) if (re.test(String(text))) return why; return null; };
export const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const packKey = (r) => `${r.kind}:${slug(r.name)}`;
export const PACK_MAX = 2000;

function textOk(s, max) {
    return typeof s === 'string' && s.length >= 1 && s.length <= max && !/[<>⟦⟧]/.test(s) && !personal(s) && !STALE_TEXT.test(s);
}
// Why a record can't go in the pack, or null when it can.
export function recordProblem(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return 'not a record';
    const spec = Object.hasOwn(PACK_FIELDS, r.kind) ? PACK_FIELDS[r.kind] : null;
    if (!spec) return `unknown kind ${r.kind}`;
    const want = ['kind', ...Object.keys(spec)].sort().join(), got = Object.keys(r).sort().join();
    if (want !== got) return `${r.kind} ${r.name}: fields ${got}, expected ${want}`;
    for (const k of Object.keys(r)) if (STALE_KEY.test(k)) return `${r.name}: a field that goes stale (${k})`;
    for (const [k, t] of Object.entries(spec)) {
        const v = r[k];
        const ok = t === 's' ? textOk(v, 80) : t === 't' ? textOk(v, 400) : t === 'n' ? Number.isFinite(v) : t === 'n?' ? v === null || Number.isFinite(v)
            : t === 'i' ? Number.isInteger(v) && v >= 0 && v <= 3000 : t === 'b' ? typeof v === 'boolean' : t === 'T' ? v === true
                : t === 'a' ? Array.isArray(v) && v.length <= 12 && v.every((x) => textOk(x, 80))
                    : t === 'd' ? Array.isArray(v) && v.length === 3 && Number.isInteger(v[0]) && v[0] >= 1900 && v[0] <= 2100 && Number.isInteger(v[1]) && v[1] >= 1 && v[1] <= 12 && Number.isInteger(v[2]) && v[2] >= 1 && v[2] <= 31 : false;
        if (!ok) return `${r.kind} ${r.name}: bad ${k} (${JSON.stringify(v)})`;
    }
    return null;
}
// The whole pack: the format, a version the page compares, and records that each pass recordProblem(), at most
// one per key. Minimum counts per kind, so a half-built pack (a source that returned nothing) is never written.
export const PACK_MIN = { country: 70, planet: 9, moon: 15, star: 20, mission: 15, element: 118, suit: 10 };
export function checkPack(p, { min = PACK_MIN } = {}) {
    const out = [];
    if (!p || p.format !== PACK_FORMAT) out.push('wrong format');
    if (!p || !Number.isInteger(p.version) || p.version < 1) out.push('no version');
    if (!p || !Array.isArray(p.records) || !p.records.length || p.records.length > PACK_MAX) { out.push('no records'); return out; }
    const keys = new Set(), n = {};
    for (const r of p.records) {
        const why = recordProblem(r); if (why) { out.push(why); continue; }
        const k = packKey(r); if (keys.has(k)) out.push(`two records for ${k}`); keys.add(k);
        n[r.kind] = (n[r.kind] || 0) + 1;
    }
    for (const [kind, m] of Object.entries(min)) if ((n[kind] || 0) < m) out.push(`only ${n[kind] || 0} ${kind} records (at least ${m})`);
    if (/population|gdp/i.test(JSON.stringify(p.records))) out.push('the records mention population or GDP');
    return out;
}

/* ---------- Text from HTML ---------- */

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', deg: '°', plusmn: '±', minus: '−', times: '×', sup2: '²', sup3: '³', middot: '·', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
export function decode(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (m, b) => {
        if (b[0] === '#') { const c = b[1] === 'x' || b[1] === 'X' ? parseInt(b.slice(2), 16) : parseInt(b.slice(1), 10); return c > 0 && c <= 0x10ffff && !(c >= 0xd800 && c <= 0xdfff) ? String.fromCodePoint(c) : ''; }
        if (Object.hasOwn(NAMED, b)) return NAMED[b];
        // Accented letters: &iacute; is í, &ntilde; is ñ, &uuml; is ü and so on.
        const acc = b.match(/^([a-z])(acute|grave|circ|tilde|uml|ring|cedil)$/i);
        if (acc) return (acc[1] + { acute: '́', grave: '̀', circ: '̂', tilde: '̃', uml: '̈', ring: '̊', cedil: '̧' }[acc[2].toLowerCase()]).normalize('NFC');
        return m;
    });
}
export const plain = (html) => decode(String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ')).replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').trim();
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
// A table, from <table> markup or from a <pre> block laid out in columns: rows of cell texts.
export function tableRows(html) {
    const rows = [];
    for (const tr of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table>|$)/gi)) {
        const cells = [...tr[1].matchAll(/<t([dh])\b[^>]*>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi)].map((c) => oneLine(plain(c[2].replace(/<\/t[dh]>/gi, ''))));
        if (cells.length) rows.push(cells);
    }
    for (const pre of String(html).matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi))
        for (const line of plain(pre[1]).split('\n')) { const cells = line.trim().split(/\s{2,}/).filter(Boolean); if (cells.length > 1) rows.push(cells); }
    return rows;
}
// The first number in a cell: "1,285,216" is 1285216, "0.384*" is 0.384, "−65" is -65, "1821.49±0.5" is 1821.49,
// "+.375" (how the star catalogue writes a parallax) is 0.375.
export function num(s) {
    const m = String(s).replace(/[−–]/g, '-').replace(/,(?=\d{3}\b)/g, '').match(/[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?/i);
    return m ? Number(m[0]) : NaN;
}
const sane = (what, v, lo, hi) => { if (!(Number.isFinite(v) && v >= lo && v <= hi)) throw new Error(`${what}: ${v} is outside ${lo} to ${hi}`); return v; };
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/* ---------- Planets: NASA's planetary fact sheet ---------- */

export const PLANET_NAMES = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
const PLANET_ROWS = { size: /^diameter/i, gravity: /^gravity/i, day: /^length of day/i, sun: /^distance from sun/i, peri: /^perihelion/i, aph: /^aphelion/i, year: /^orbital period/i, temp: /^mean temperature/i, rings: /^ring system/i };
export function parsePlanets(html) {
    const rows = tableRows(html);
    const head = rows.find((r) => r.some((c) => /^mercury$/i.test(c)) && r.some((c) => /^neptune$/i.test(c)));
    if (!head) throw new Error('planets: no header row naming MERCURY to NEPTUNE');
    const col = (name) => head.findIndex((c) => c.toLowerCase() === name.toLowerCase());
    const shift = rows.find((r) => PLANET_ROWS.size.test(r[0])).length - head.length; // the label cell, when the header has none
    const out = [];
    for (const name of PLANET_NAMES) {
        const ci = col(name); if (ci < 0) throw new Error(`planets: no column for ${name}`);
        const rec = { kind: 'planet', name };
        for (const [k, re] of Object.entries(PLANET_ROWS)) {
            const row = rows.find((r) => re.test(r[0])); if (!row) throw new Error(`planets: no row for ${k}`);
            const cell = row[ci + shift] ?? '';
            if (k === 'rings') { if (!/^(yes|no)\b/i.test(cell)) throw new Error(`planets: ${name} rings "${cell}"`); rec.rings = /^yes/i.test(cell); } else rec[k] = num(cell);
        }
        sane(`${name} diameter`, rec.size, 1000, 200000); sane(`${name} distance`, rec.sun, 30, 8000); sane(`${name} perihelion`, rec.peri, 30, rec.sun); sane(`${name} aphelion`, rec.aph, rec.sun, 9000);
        sane(`${name} day`, Math.abs(rec.day), 5, 6000); sane(`${name} year`, rec.year, 50, 100000); sane(`${name} gravity`, rec.gravity, 0.1, 40); sane(`${name} temperature`, rec.temp, -273, 500);
        rec.dwarf = name === 'Pluto';
        out.push(rec);
    }
    return out;
}

/* ---------- Major moons: JPL's satellite physical parameters ---------- */

// [name, the planet it goes round, roughly its radius in km]. The rough radius only guards the parsing: a value
// more than 15% off means the table was read wrong, and the build stops.
export const MOONS = [['Moon', 'Earth', 1737], ['Phobos', 'Mars', 11], ['Deimos', 'Mars', 6.2], ['Io', 'Jupiter', 1822], ['Europa', 'Jupiter', 1561], ['Ganymede', 'Jupiter', 2631], ['Callisto', 'Jupiter', 2410],
    ['Mimas', 'Saturn', 198], ['Enceladus', 'Saturn', 252], ['Tethys', 'Saturn', 533], ['Dione', 'Saturn', 561], ['Rhea', 'Saturn', 764], ['Titan', 'Saturn', 2575], ['Iapetus', 'Saturn', 735],
    ['Miranda', 'Uranus', 236], ['Ariel', 'Uranus', 579], ['Umbriel', 'Uranus', 585], ['Titania', 'Uranus', 789], ['Oberon', 'Uranus', 761], ['Triton', 'Neptune', 1353], ['Charon', 'Pluto', 606]];
export function parseMoons(html) {
    const rows = tableRows(html);
    const head = rows.find((r) => r.some((c) => /radius/i.test(c)) && r.some((c) => /density/i.test(c)));
    const out = [];
    for (const [name, planet, about] of MOONS) {
        const row = rows.find((r) => r.some((c) => c.toLowerCase() === name.toLowerCase()));
        if (!row) throw new Error(`moons: no row for ${name}`);
        const at = row.findIndex((c) => c.toLowerCase() === name.toLowerCase());
        let radius, density;
        if (head) {
            // Line the row up with the header by its name column: a planet named only on its first moon's row shifts the rest.
            const hn = head.findIndex((c) => /sat|name|moon/i.test(c)), off = at - (hn < 0 ? 0 : hn);
            radius = num(row[head.findIndex((c) => /radius/i.test(c)) + off]); density = num(row[head.findIndex((c) => /density/i.test(c)) + off]);
        }
        if (!(Math.abs(radius - about) <= about * 0.15)) { const n = row.slice(at + 1).map(num).filter(Number.isFinite); radius = n[1]; density = n[2]; } // GM, radius, density
        if (!(Math.abs(radius - about) <= about * 0.15)) throw new Error(`moons: ${name} radius ${radius}, expected about ${about}. The table's header row: ${JSON.stringify(head)}; ${name}'s row: ${JSON.stringify(row)}`);
        sane(`${name} density`, density, 0.3, 6);
        out.push({ kind: 'moon', name, planet, radius: round(radius, 1), density: round(density, 3) });
    }
    return out;
}

/* ---------- Stars: the Yale Bright Star Catalogue ---------- */

// [name, HR number, Bayer letter and constellation as the catalogue writes them]. The build checks the catalogue's
// own name for each HR number, so a wrong number stops it rather than describing the wrong star.
export const STARS = [['Sirius', 2491, 'Alp CMa'], ['Canopus', 2326, 'Alp Car'], ['Arcturus', 5340, 'Alp Boo'], ['Vega', 7001, 'Alp Lyr'], ['Capella', 1708, 'Alp Aur'], ['Rigel', 1713, 'Bet Ori'],
    ['Procyon', 2943, 'Alp CMi'], ['Achernar', 472, 'Alp Eri'], ['Betelgeuse', 2061, 'Alp Ori'], ['Hadar', 5267, 'Bet Cen'], ['Altair', 7557, 'Alp Aql'], ['Aldebaran', 1457, 'Alp Tau'],
    ['Antares', 6134, 'Alp Sco'], ['Spica', 5056, 'Alp Vir'], ['Pollux', 2990, 'Bet Gem'], ['Fomalhaut', 8728, 'Alp PsA'], ['Deneb', 7924, 'Alp Cyg'], ['Regulus', 3982, 'Alp Leo'],
    ['Castor', 2891, 'Alp Gem'], ['Polaris', 424, 'Alp UMi'], ['Alpha Centauri', 5459, 'Alp1Cen'], ['Bellatrix', 1790, 'Gam Ori'], ['Mizar', 5054, 'Zet UMa'], ['Algol', 936, 'Bet Per'], ['Alnilam', 1903, 'Eps Ori']];
export const CONSTELLATIONS = { CMa: 'Canis Major', Car: 'Carina', Boo: 'Boötes', Lyr: 'Lyra', Aur: 'Auriga', Ori: 'Orion', CMi: 'Canis Minor', Eri: 'Eridanus', Cen: 'Centaurus', Aql: 'Aquila', Tau: 'Taurus',
    Sco: 'Scorpius', Vir: 'Virgo', Gem: 'Gemini', PsA: 'Piscis Austrinus', Cyg: 'Cygnus', Leo: 'Leo', UMi: 'Ursa Minor', UMa: 'Ursa Major', Per: 'Perseus' };
// A parallax under 0.06" (beyond about 55 light years) is too uncertain in this catalogue to give a distance, so
// those stars have none rather than a wrong one.
const PARALLAX_MIN = 0.06, LY_PER_PARSEC = 3.26156;
export function parseStars(buf) {
    const text = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : Buffer.from(buf)).toString('latin1');
    const byHr = new Map();
    for (const line of text.split(/\r?\n/)) { const hr = parseInt(line.slice(0, 4), 10); if (hr) byHr.set(hr, line); }
    if (byHr.size < 20) throw new Error('stars: the catalogue has almost no lines');
    return STARS.map(([name, hr, bayer]) => {
        const l = byHr.get(hr); if (!l) throw new Error(`stars: no HR ${hr} (${name})`);
        // Byte columns from the catalogue's ReadMe: Name 5-14, Vmag 103-107, SpType 128-147, n_Parallax 161, Parallax 162-166.
        const nm = l.slice(4, 14).replace(/^\s*\d*/, '').trim();
        if (nm.replace(/\s+/g, ' ') !== bayer.replace(/\s+/g, ' ')) throw new Error(`stars: HR ${hr} is "${nm}", expected ${bayer} (${name})`);
        const con = bayer.slice(-3), mag = num(l.slice(102, 107)), spectral = l.slice(127, 147).trim(), dyn = l.slice(160, 161) === 'D', plx = num(l.slice(161, 166));
        if (!CONSTELLATIONS[con]) throw new Error(`stars: no name for constellation ${con}`);
        sane(`${name} magnitude`, mag, -2, 4); if (!/^[OBAFGKM]/.test(spectral)) throw new Error(`stars: ${name} spectral type "${spectral}"`);
        const ly = !dyn && plx >= PARALLAX_MIN ? round(LY_PER_PARSEC / plx, 1) : null;
        if (ly !== null) sane(`${name} distance in light years`, ly, 4, 55);
        return { kind: 'star', name, constellation: CONSTELLATIONS[con], spectral, mag, ly };
    });
}

/* ---------- Missions: launch dates from NASA's master catalogue ---------- */

// [name, COSPAR ID, words the catalogue page must contain, destination, agency]. The launch year must match the ID's
// own year, and the page must name the craft, so a wrong ID stops the build.
export const MISSIONS = [
    ['Sputnik 1', '1957-001B', 'Sputnik 1', 'Earth orbit, as the first artificial satellite', 'the Soviet Union'],
    ['Explorer 1', '1958-001A', 'Explorer 1', 'Earth orbit, as the first American satellite', 'the United States'],
    ['Vostok 1', '1961-012A', 'Vostok 1', 'Earth orbit, with the first person in space, Yuri Gagarin', 'the Soviet Union'],
    ['Apollo 11', '1969-059A', 'Apollo 11', 'the Moon, for the first crewed landing', 'NASA'],
    ['Apollo 13', '1970-029A', 'Apollo 13', 'the Moon, though the landing was called off after an explosion on board', 'NASA'],
    ['Pioneer 10', '1972-012A', 'Pioneer 10', 'Jupiter, and then out of the solar system', 'NASA'],
    ['Viking 1', '1975-075A', 'Viking 1', 'Mars, with an orbiter and a lander', 'NASA'],
    ['Voyager 2', '1977-076A', 'Voyager 2', 'Jupiter, Saturn, Uranus and Neptune', 'NASA'],
    ['Voyager 1', '1977-084A', 'Voyager 1', 'Jupiter and Saturn, and then interstellar space', 'NASA'],
    ['Galileo', '1989-084B', 'Galileo', 'Jupiter and its moons', 'NASA'],
    ['Hubble Space Telescope', '1990-037B', 'Hubble', 'Earth orbit, as a space telescope', 'NASA and ESA'],
    ['Cassini', '1997-061A', 'Cassini', 'Saturn and its moons, carrying the Huygens probe to Titan', 'NASA, ESA and the Italian space agency'],
    ['Spirit', '2003-027A', 'Spirit', 'Mars, as a rover', 'NASA'],
    ['Opportunity', '2003-032A', 'Opportunity', 'Mars, as a rover', 'NASA'],
    ['New Horizons', '2006-001A', 'New Horizons', 'Pluto and the Kuiper belt', 'NASA'],
    ['Kepler', '2009-011A', 'Kepler', 'an orbit round the Sun, to find planets round other stars', 'NASA'],
    ['Juno', '2011-040A', 'Juno', 'Jupiter', 'NASA'],
    ['Curiosity', '2011-070A', 'Curiosity', 'Mars, as a rover', 'NASA'],
    ['Parker Solar Probe', '2018-065A', 'Parker Solar Probe', 'the Sun, closer than any spacecraft before it', 'NASA'],
    ['Perseverance', '2020-052A', 'Perseverance', 'Mars, as a rover with the Ingenuity helicopter', 'NASA'],
    ['James Webb Space Telescope', '2021-130A', 'Webb', 'a point beyond the Moon, as a space telescope', 'NASA, ESA and the Canadian Space Agency'],
    ['Artemis I', '2022-156A', 'Artemis', 'the Moon and back, uncrewed', 'NASA'],
    ['Europa Clipper', '2024-182A', 'Europa Clipper', 'Jupiter, to study its moon Europa', 'NASA']
];
export const missionUrl = (id) => `https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=${id}`;
export function parseMission(html, [name, id, must, target, agency]) {
    const t = oneLine(plain(html));
    if (!t.toLowerCase().includes(must.toLowerCase())) throw new Error(`missions: the page for ${id} doesn't mention ${must}`);
    if (!t.includes(id)) throw new Error(`missions: the page for ${name} doesn't show its ID ${id}`);
    const m = t.match(/Launch Date:?\s*(\d{4})-(\d{2})-(\d{2})/i);
    if (!m) throw new Error(`missions: no launch date for ${name} (${id})`);
    const launch = [+m[1], +m[2], +m[3]];
    if (String(launch[0]) !== id.slice(0, 4)) throw new Error(`missions: ${name} launched in ${launch[0]}, but its ID says ${id.slice(0, 4)}`);
    return { kind: 'mission', name, launch, target, agency };
}

/* ---------- Elements: PubChem's periodic table ---------- */

export function parseElements(json) {
    const t = (typeof json === 'string' ? JSON.parse(json) : json).Table;
    const cols = t.Columns.Column, at = (n) => { const i = cols.indexOf(n); if (i < 0) throw new Error(`elements: no column ${n}`); return i; };
    const I = Object.fromEntries(['AtomicNumber', 'Symbol', 'Name', 'AtomicMass', 'StandardState', 'MeltingPoint', 'BoilingPoint', 'GroupBlock', 'YearDiscovered'].map((n) => [n, at(n)]));
    const kToC = (s) => (s === '' || s == null || !Number.isFinite(num(s)) ? null : round(num(s) - 273.15, 1));
    const out = t.Row.map(({ Cell: c }) => {
        const year = c[I.YearDiscovered];
        const rec = {
            kind: 'element', name: c[I.Name], symbol: c[I.Symbol], n: parseInt(c[I.AtomicNumber], 10), mass: num(c[I.AtomicMass]),
            state: String(c[I.StandardState]).toLowerCase(), family: String(c[I.GroupBlock]).toLowerCase(),
            melt: kToC(c[I.MeltingPoint]), boil: kToC(c[I.BoilingPoint]), found: /^ancient$/i.test(year) ? 0 : parseInt(year, 10)
        };
        if (!/^[A-Z][a-z]{0,2}$/.test(rec.symbol)) throw new Error(`elements: symbol "${rec.symbol}"`);
        sane(`${rec.name} mass`, rec.mass, 1, 300); sane(`${rec.name} year`, rec.found, 0, 2030);
        return rec;
    });
    if (out.length !== 118 || out.some((e, i) => e.n !== i + 1)) throw new Error(`elements: expected 1 to 118 in order, got ${out.length}`);
    return out;
}

/* ---------- Countries: the World Factbook ---------- */

// Every country the globe can find (COUNTRY_DATA in jarvis-test.html), apart from England and Scotland, which the
// Factbook covers only as part of the United Kingdom. [the globe's name, the Factbook file, the Factbook's own short
// name for it, checked so a wrong file stops the build]. Codes are the Factbook's own (GEC), not ISO.
export const COUNTRIES = [
    ['United States', 'north-america/us', 'United States'], ['Canada', 'north-america/ca', 'Canada'], ['Mexico', 'north-america/mx', 'Mexico'], ['Greenland', 'north-america/gl', 'Greenland'],
    ['Brazil', 'south-america/br', 'Brazil'], ['Argentina', 'south-america/ar', 'Argentina'], ['Chile', 'south-america/ci', 'Chile'], ['Peru', 'south-america/pe', 'Peru'], ['Colombia', 'south-america/co', 'Colombia'],
    ['Venezuela', 'south-america/ve', 'Venezuela'], ['Bolivia', 'south-america/bl', 'Bolivia'], ['Ecuador', 'south-america/ec', 'Ecuador'],
    ['Cuba', 'central-america-n-caribbean/cu', 'Cuba'], ['Jamaica', 'central-america-n-caribbean/jm', 'Jamaica'],
    ['Iceland', 'europe/ic', 'Iceland'], ['United Kingdom', 'europe/uk', 'United Kingdom'], ['Ireland', 'europe/ei', 'Ireland'], ['France', 'europe/fr', 'France'], ['Spain', 'europe/sp', 'Spain'],
    ['Portugal', 'europe/po', 'Portugal'], ['Germany', 'europe/gm', 'Germany'], ['Italy', 'europe/it', 'Italy'], ['Switzerland', 'europe/sz', 'Switzerland'], ['Netherlands', 'europe/nl', 'Netherlands'],
    ['Belgium', 'europe/be', 'Belgium'], ['Austria', 'europe/au', 'Austria'], ['Poland', 'europe/pl', 'Poland'], ['Czechia', 'europe/ez', 'Czechia'], ['Greece', 'europe/gr', 'Greece'],
    ['Sweden', 'europe/sw', 'Sweden'], ['Norway', 'europe/no', 'Norway'], ['Finland', 'europe/fi', 'Finland'], ['Denmark', 'europe/da', 'Denmark'], ['Ukraine', 'europe/up', 'Ukraine'],
    ['Russia', 'central-asia/rs', 'Russia'], ['Kazakhstan', 'central-asia/kz', 'Kazakhstan'], ['Turkey', 'middle-east/tu', 'Turkey'],
    ['Egypt', 'africa/eg', 'Egypt'], ['Morocco', 'africa/mo', 'Morocco'], ['Algeria', 'africa/ag', 'Algeria'], ['Libya', 'africa/ly', 'Libya'], ['Nigeria', 'africa/ni', 'Nigeria'], ['Ghana', 'africa/gh', 'Ghana'],
    ['Kenya', 'africa/ke', 'Kenya'], ['Ethiopia', 'africa/et', 'Ethiopia'], ['Tanzania', 'africa/tz', 'Tanzania'], ['South Africa', 'africa/sf', 'South Africa'], ['Madagascar', 'africa/ma', 'Madagascar'],
    ['DR Congo', 'africa/cg', 'DRC'], ['Sudan', 'africa/su', 'Sudan'], ['Somalia', 'africa/so', 'Somalia'],
    ['Saudi Arabia', 'middle-east/sa', 'Saudi Arabia'], ['Iran', 'middle-east/ir', 'Iran'], ['Iraq', 'middle-east/iz', 'Iraq'], ['Israel', 'middle-east/is', 'Israel'],
    ['Pakistan', 'south-asia/pk', 'Pakistan'], ['Afghanistan', 'south-asia/af', 'Afghanistan'], ['India', 'south-asia/in', 'India'], ['Nepal', 'south-asia/np', 'Nepal'], ['Bangladesh', 'south-asia/bg', 'Bangladesh'], ['Sri Lanka', 'south-asia/ce', 'Sri Lanka'],
    ['China', 'east-n-southeast-asia/ch', 'China'], ['Mongolia', 'east-n-southeast-asia/mg', 'Mongolia'], ['Japan', 'east-n-southeast-asia/ja', 'Japan'], ['South Korea', 'east-n-southeast-asia/ks', 'South Korea'],
    ['North Korea', 'east-n-southeast-asia/kn', 'North Korea'], ['Taiwan', 'east-n-southeast-asia/tw', 'Taiwan'], ['Philippines', 'east-n-southeast-asia/rp', 'Philippines'], ['Vietnam', 'east-n-southeast-asia/vm', 'Vietnam'],
    ['Thailand', 'east-n-southeast-asia/th', 'Thailand'], ['Indonesia', 'east-n-southeast-asia/id', 'Indonesia'], ['Malaysia', 'east-n-southeast-asia/my', 'Malaysia'], ['Papua New Guinea', 'east-n-southeast-asia/pp', 'Papua New Guinea'],
    ['Australia', 'australia-oceania/as', 'Australia'], ['New Zealand', 'australia-oceania/nz', 'New Zealand'], ['Fiji', 'australia-oceania/fj', 'Fiji']
];
export const factbookUrl = (path) => `https://raw.githubusercontent.com/factbook/factbook.json/${FACTBOOK_SHA}/${path}.json`;
const REGIONS = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Middle East', 'Southeast Asia', 'Central America and the Caribbean', 'Arctic Region'];
// Ukraine's archived entry runs two regions together ("AsiaEurope"); the Factbook placed it in Europe.
const REGION_FIX = { 'europe/up': 'Europe' };
const COLOURS = ['crimson red', 'golden yellow', 'sky blue', 'light blue', 'dark blue', 'cobalt blue', 'red', 'white', 'blue', 'green', 'yellow', 'black', 'gold', 'orange', 'saffron', 'crimson', 'maroon'];
const t = (o) => (o && typeof o.text === 'string' ? o.text : '');
const noBrackets = (s) => { let x = s; for (let i = 0; i < 3; i++) x = x.replace(/\s*\([^()]*\)/g, ''); return x.replace(/\s+([,;.])/g, '$1').replace(/\s+/g, ' ').trim(); };
// Split at semicolons that aren't inside quotes.
const clauses = (s) => { const out = []; let cur = '', q = false; for (const ch of s) { if (ch === '"') q = !q; if (ch === ';' && !q) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
export function parseCountry(json, [name, path, fbName]) {
    const d = typeof json === 'string' ? JSON.parse(json) : json, g = d.Geography || {}, gov = d.Government || {};
    const short = oneLine(plain(t(gov['Country name']?.['conventional short form'])));
    if (short !== fbName) throw new Error(`countries: ${path} is "${short}", expected ${fbName}`);
    // Capital: each capital named, without the notes in brackets ("La Paz (administrative capital); Sucre (…)").
    const capital = clauses(plain(t(gov.Capital?.name)).split('\n')[0]).filter((c) => !/^note\b/i.test(c)).map(noBrackets).filter(Boolean);
    // Region: the Factbook's map region; for France, metropolitan France's.
    const mr = t(g['Map references']), first = /<strong>/i.test(mr) ? (mr.match(/<\/strong>([^<]*)/i) || [])[1] || '' : mr;
    const region = REGION_FIX[path] || oneLine(plain(first));
    if (!REGIONS.includes(region)) throw new Error(`countries: ${name} region "${region}"`);
    const area = num(t(g.Area?.['total '] || g.Area?.total));
    // Highest point: "Nevado Huascaran 6,746 m", without notes or brackets.
    const hp = noBrackets(plain(t(g.Elevation?.['highest point'])).split(/\n|;\s*note|\bnote\s*-/i)[0]);
    const hm = hp.match(/^(.*?)[\s,]+(\d[\d,]*)(?:\s*m)?\b\.?$/);
    if (!hm) throw new Error(`countries: ${name} highest point "${hp}"`);
    // Flag: the description (not its meaning), up to two clauses, kept under 300 characters.
    const desc = (t(gov['Flag description']) || t(gov.Flag)).split(/<br\s*\/?>\s*<br\s*\/?>/i)[0];
    const dtext = noBrackets(oneLine(plain(desc)).replace(/^description:\s*/i, ''));
    const cl = clauses(dtext);
    let flag = cl[0] || '';
    if (cl[1] && (flag + '; ' + cl[1]).length <= 260) flag += '; ' + cl[1];
    if (flag.length > 300) flag = flag.slice(0, flag.lastIndexOf(', ', 300));
    const low = dtext.toLowerCase().replace(/sky-blue/g, 'sky blue'), colours = [];
    for (const m of low.matchAll(new RegExp(`\\b(${COLOURS.join('|')})\\b`, 'g'))) {
        const c = m[1] === 'golden yellow' ? 'gold' : m[1] === 'crimson red' ? 'crimson' : m[1];
        if (!colours.includes(c)) colours.push(c);
    }
    const rec = { kind: 'country', name, capital, region, area, high: hm[1].replace(/,$/, '').trim(), high_m: num(hm[2]), flag, colours };
    if (!capital.length) throw new Error(`countries: ${name} has no capital`);
    sane(`${name} area`, area, 100, 2e7); sane(`${name} highest point`, rec.high_m, 50, 9000);
    if (!colours.length) throw new Error(`countries: ${name} flag has no colours`);
    return rec;
}

/* ---------- Iron Man suits: hand-written fan knowledge ---------- */

export function parseSuits(json) {
    const list = typeof json === 'string' ? JSON.parse(json) : json;
    return list.suits.map((s) => ({ kind: 'suit', name: s.name, aka: s.aka, film: s.film, line: s.line, fan: true }));
}

/* ---------- Putting it together ---------- */

// get(url, {binary}) returns the text (or bytes) at a URL. The real build fetches; the dry run reads fixtures.
export async function buildPack(get, suitsJson) {
    // Every source is tried even when one fails, so a single run names every page that didn't parse.
    const problems = [], part = async (what, f) => { try { return await f(); } catch (e) { problems.push(e.message); return []; } };
    const parts = [
        await part('planets', async () => parsePlanets(await get(SOURCES[0].url))),
        await part('moons', async () => parseMoons(await get(SOURCES[1].url))),
        await part('stars', async () => parseStars(await get(SOURCES[2].url, { binary: true }))),
        await part('missions', async () => Promise.all(MISSIONS.map(async (m) => parseMission(await get(missionUrl(m[1])), m)))),
        await part('elements', async () => parseElements(await get(SOURCES[4].url))),
        await part('countries', async () => Promise.all(COUNTRIES.map(async (c) => parseCountry(await get(factbookUrl(c[1])), c)))),
        await part('suits', async () => parseSuits(suitsJson))
    ];
    if (problems.length) throw new Error(problems.join('\n'));
    const records = [
        ...parts.flat()
    ].sort((a, b) => (a.kind === b.kind ? (a.name < b.name ? -1 : 1) : a.kind < b.kind ? -1 : 1));
    // The version is worked out from the records, so the page fetches a new pack only when the facts change.
    const version = parseInt(createHash('sha256').update(JSON.stringify(records)).digest('hex').slice(0, 8), 16) || 1;
    return { format: PACK_FORMAT, version, sources: SOURCES.map(({ id, name, url, licence, used }) => ({ id, name, url, licence, used })), records };
}

async function fetchReal(url, { binary = false } = {}) {
    for (let attempt = 1; ; attempt++) {
        try {
            const r = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
        } catch (e) {
            if (attempt >= 3) throw new Error(`${url}: ${e.message}`);
            await new Promise((res) => setTimeout(res, 2000 * attempt));
        }
    }
}
// Fixtures: manifest.json maps each source URL to a file in the fixtures folder.
export async function fixtureGetter(dir) {
    const base = new URL(dir.endsWith('/') ? dir : dir + '/', 'file://' + process.cwd() + '/');
    const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
    return async (url, { binary = false } = {}) => {
        if (!Object.hasOwn(manifest, url)) throw new Error(`no fixture for ${url}`);
        const buf = await readFile(new URL(manifest[url], base));
        return binary ? buf : buf.toString('utf8');
    };
}

async function main(argv) {
    const arg = (n) => { const a = argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
    const dry = argv.includes('--dry-run'), out = arg('out'), check = arg('check');
    if (check) {
        const problems = checkPack(JSON.parse(await readFile(check, 'utf8')));
        console.log(problems.length ? problems.join('\n') : `${check}: OK`);
        return problems.length ? 1 : 0;
    }
    const fixtures = arg('fixtures') || (dry ? fileURLToPath(new URL('../../tests/fixtures/jarvis-knowledge/', import.meta.url)) : null);
    const get = fixtures ? await fixtureGetter(fixtures) : fetchReal;
    const pack = await buildPack(get, await readFile(new URL('suits.json', HERE), 'utf8'));
    const problems = checkPack(pack);
    const counts = {}; for (const r of pack.records) counts[r.kind] = (counts[r.kind] || 0) + 1;
    console.log(`${fixtures ? 'From fixtures' : 'From the real sources'}: ${pack.records.length} records`, counts, `version ${pack.version}`);
    if (problems.length) { console.error('Refused:\n' + problems.join('\n')); return 1; }
    const body = JSON.stringify(pack) + '\n';
    if (out) { await writeFile(out, body); console.log(`Wrote ${out} (${body.length} bytes).`); }
    if (dry || fixtures) return 0;
    const target = new URL('pack.json', HERE);
    let old = null; try { old = JSON.parse(await readFile(target, 'utf8')); } catch { /* first build */ }
    if (old && old.version === pack.version) { console.log('pack.json is unchanged.'); return 0; }
    await writeFile(target, body);
    console.log(`Wrote pack.json (${body.length} bytes).`);
    return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e.message); process.exitCode = 1; });
}
