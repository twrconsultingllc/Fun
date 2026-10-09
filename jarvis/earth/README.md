# J.A.R.V.I.S. Earth globe: land data

`land-110m.json` holds the coastlines for the globe in `jarvis.html` / `jarvis-test.html`.
The page fetches it from this site, so the page's `connect-src 'self'` still holds and
nothing about the globe comes from another host.

- **Source:** Natural Earth 1:110m land, version 4.1.0, which is public domain
  (<https://www.naturalearthdata.com/about/terms-of-use/>), as redistributed in the
  `world-atlas` npm package 2.0.2 (ISC licence), file `land-110m.json`.
- **Converted by:** `build-land.mjs` in this folder, using `topojson-client` 3.1.0. It flattens
  the TopoJSON into rings of longitude, latitude pairs in tenths of a degree, and drops points that
  round onto the one before. That gives 126 rings and 5,114 points.
- **Pinned:** sha256 `ec085257c3276958638a03e82162e7ce0fb6c8cd13692ba91bd7941df425512c`.
  `tests/jarvis-test.dom.test.mjs` checks this hash, so a changed file fails the suite until this line
  is updated too.

To rebuild:

```bash
npm pack world-atlas@2.0.2 topojson-client@3.1.0
```

Unpack both tarballs, then:

```bash
node build-land.mjs <world-atlas>/package/land-110m.json <topojson-client>/package/dist/topojson-client.js
```

The npm tarballs this was built from had these sha256 hashes:
`world-atlas-2.0.2.tgz` `032e7765f2ce00edaeafec23ff22bc3b77e42987c257da944cc585b452c05b97`,
`topojson-client-3.1.0.tgz` `889fadb422f6236d0f8337a236ce6499f258b75e44b81733b13bd971067322bf`.

At this scale coastlines are coarse, so 17 of the page's 243 cities (most of them on a coast) fall just
outside a land ring. Taps check for a nearby city before asking whether a spot is land or sea, so
that doesn't show.
