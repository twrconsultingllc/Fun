// Turns Natural Earth's 1:110m land (from the world-atlas npm package) into jarvis/earth/land-110m.json:
// one array of rings, each a flat list of longitude, latitude pairs in tenths of a degree.
// Run once by hand; the page only ever reads the JSON it writes.
//   npm pack world-atlas@2.0.2 topojson-client@3.1.0   (unpack both)
//   node build-land.mjs <world-atlas>/land-110m.json <topojson-client>/dist/topojson-client.js
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const [src, client] = process.argv.slice(2);
if (!src || !client) { console.error('usage: node build-land.mjs land-110m.json topojson-client.js'); process.exit(1); }
const { feature } = createRequire(import.meta.url)(client);
const topo = JSON.parse(readFileSync(src, 'utf8'));
const land = feature(topo, topo.objects.land);
const rings = [];
for (const f of land.features ?? [land]) {
  const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const poly of polys) for (const ring of poly) {
    const flat = [];
    for (const [lon, lat] of ring) {
      const a = Math.round(lon * 10), b = Math.round(lat * 10), n = flat.length;
      if (n && flat[n - 2] === a && flat[n - 1] === b) continue; // drop points that round onto the last one
      flat.push(a, b);
    }
    if (flat.length >= 8) rings.push(flat);
  }
}
const out = { source: 'Natural Earth 1:110m land, public domain, via world-atlas 2.0.2 (ISC). Tenths of a degree: lon, lat, lon, lat, ...', rings };
const dest = fileURLToPath(new URL('land-110m.json', import.meta.url));
writeFileSync(dest, JSON.stringify(out) + '\n');
console.log(`${rings.length} rings, ${rings.reduce((s, r) => s + r.length / 2, 0)} points → ${dest}`);
