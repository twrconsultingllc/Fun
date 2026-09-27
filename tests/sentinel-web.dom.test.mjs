/* sentinel-web.html — a browser version of the Sentinel tracker detector:
 * Web Bluetooth scanning (Chrome's experimental requestLEScan), location
 * tagging, the app's place clustering, rotation linking, scoring and flag
 * decisions, the Nearby / Flagged / Device Detail screens and the hot/cold
 * finder, and the Nearby screen's device swarm (the 3JS gallery's 3.3
 * Particle Swarm, drawn around you on a 2D canvas).
 *
 * jsdom has no navigator.bluetooth, geolocation or IndexedDB, so the page runs
 * in its memory-only mode. The suite drives it through window.__sentinelWeb:
 * the pure rules first, each expected value worked out by hand from the
 * Sentinel app's Kotlin (FlagScorer, TrackerCorrelationEngine, FlagDecision,
 * RotationLinker, ProximityTracker), then a scripted day — a Find My tag that
 * follows the user across three places and changes its Chrome ID on the way,
 * next to an iPhone and a router that must not be flagged — and the screens
 * that result. */

import { openDom } from './lib/page.mjs';

export const name = 'Sentinel Web (sentinel-web.html)';

const BASE_UUID = (short) => `0000${short.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
const MIN = 60 * 1000;

function event(window, { id, name = '', rssi = -60, manufacturer = {}, serviceData = {}, uuids = [] }) {
    const view = (bytes) => new window.DataView(new window.Uint8Array(bytes).buffer);
    const m = new window.Map(Object.entries(manufacturer).map(([k, v]) => [Number(k), view(v)]));
    const s = new window.Map(Object.entries(serviceData).map(([k, v]) => [BASE_UUID(Number(k)), view(v)]));
    return { device: { id, name }, name, rssi, manufacturerData: m, serviceData: s, uuids: uuids.map(BASE_UUID) };
}

// Places for the scripted day. 0.027° of latitude is 3.00 km (R = 6371.0088 km).
const PLACE = {
    A: { lat: 26.1000, lon: -81.8000 },
    B: { lat: 26.1270, lon: -81.8000 },
    C: { lat: 26.1540, lon: -81.8000 },
    D: { lat: 26.1270, lon: -81.7700 }
};

export default async function run(t, page) {
    let env;
    try {
        env = await openDom(page.html, page.url);
    } catch (error) {
        t.ok('the page opens in jsdom', false);
        t.note(error.message);
        return;
    }

    const { window, document, errors } = env;
    const api = window.__sentinelWeb;

    try {
        await api.ready;

        t.section('Booting without Web Bluetooth');

        t.eq('the page has no console errors', errors.length, 0);
        if (errors.length) t.note(errors.join('\n       '));
        const checks = document.getElementById('checks').textContent;
        t.ok('the checks say scanning isn\'t available', /Scanning isn't available/.test(checks));
        t.ok('the setup panel opens itself when the browser can\'t scan', document.getElementById('setup').open);
        t.ok('the chips say data is memory-only when there is no IndexedDB', /memory only/.test(document.getElementById('chips').textContent));
        t.ok('links back to the Fun index', !!document.querySelector('a[href="index.html"]'));

        t.section('Security basics');

        const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '';
        t.ok('the CSP forbids all fetches (connect-src \'none\')', /connect-src 'none'/.test(csp));
        t.ok('images only from the page and OpenStreetMap tiles', /img-src 'self' https:\/\/tile\.openstreetmap\.org;/.test(csp));
        t.ok('the CSP has form-action \'none\' and base-uri \'none\'', /form-action 'none'/.test(csp) && /base-uri 'none'/.test(csp));
        t.eq('loads no external scripts', document.querySelectorAll('script[src]').length, 0);
        t.eq('has a referrer policy', document.querySelector('meta[name="referrer"]')?.content, 'strict-origin-when-cross-origin');
        const src = page.html;
        t.ok('no innerHTML / insertAdjacentHTML / document.write / eval in the page', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(src));

        t.section('Rules ported from the app');

        const d1deg = api.haversine(0, 0, 1, 0);
        t.ok('haversine: one degree of latitude is 111.19 km', Math.abs(d1deg - 111195) < 5);

        const cl = api.createClusterer([], 150);
        const p1 = cl.assign(26.1, -81.8);
        const p2 = cl.assign(26.1009, -81.8); // 100 m north: same place
        const p3 = cl.assign(26.1027, -81.8); // 300 m north of the first: new place
        t.eq('a fix within 150 m joins the place', p2.id, p1.id);
        t.ok('…and moves its centre to the mean of the two fixes', Math.abs(p2.lat - 26.10045) < 1e-9);
        t.ok('a fix farther than 150 m starts a new place', p3.id !== p1.id);

        const sig = (id) => api.SIGNATURES.find((s) => s.id === id);
        const parse = (opts) => api.parseAdvertisement(event(window, { id: 'x', ...opts }));
        t.eq('Find My 4C 00 12 19 … matches', api.matchSignature(parse({ manufacturer: { 0x004C: [0x12, 0x19, 0x10] } }))?.id, 'apple_find_my');
        t.eq('an iPhone nearby message 4C 00 10 … does not', api.matchSignature(parse({ manufacturer: { 0x004C: [0x10, 0x05] } })), null);
        t.eq('Find Hub FEAA frame 0x40 matches', api.matchSignature(parse({ serviceData: { 0xFEAA: [0x40] } }))?.id, 'google_fmdn');
        t.eq('Fast Pair 0xFE2C does not', api.matchSignature(parse({ uuids: [0xFE2C] })), null);
        t.eq('Find My length 0x19 is separated from its owner', api.ownerState(parse({ manufacturer: { 0x004C: [0x12, 0x19, 0x10] } })), 'separated');
        t.eq('Find My length 0x02 is near its owner', api.ownerState(parse({ manufacturer: { 0x004C: [0x12, 0x02, 0x10] } })), 'near_owner');
        t.eq('the status byte is the third payload byte', api.statusByte(parse({ manufacturer: { 0x004C: [0x12, 0x19, 0x34] } })), 0x34);

        // FlagScorer: places 15 at 3 (+5 each, max 30); spread 20 × m/5000 (max 20); visits 5 per extra (max 15); signature weight.
        const m = (o) => ({ distinctClusters: 3, maxSpreadMeters: 0, spanMs: 25 * MIN, sessions: 1, nearOwnerOnly: false, ...o });
        t.eq('3 places, 2.5 km, 1 visit, Find My: 15 + 10 + 0 + 35 = 60', api.scoreOf(m({ maxSpreadMeters: 2500 }), 'payload', sig('apple_find_my')), 60);
        t.eq('6 places, 9 km, 5 visits, no signature: 30 + 20 + 15 = 65 (all capped)', api.scoreOf(m({ distinctClusters: 6, maxSpreadMeters: 9000, sessions: 5 }), 'payload', null), 65);
        t.eq('near-owner-only Find My gets 5, not 35: 15 + 10 + 5 = 30', api.scoreOf(m({ maxSpreadMeters: 2500, nearOwnerOnly: true }), 'payload', sig('apple_find_my')), 30);
        t.eq('Chrome-ID-only identity over 31 min is halved: (15 + 20) × 0.5 = 17.5 → 18', api.scoreOf(m({ maxSpreadMeters: 6000, spanMs: 31 * MIN }), 'mac_only', null), 18);
        t.eq('…but not at 30 min: 35', api.scoreOf(m({ maxSpreadMeters: 6000, spanMs: 30 * MIN }), 'mac_only', null), 35);
        t.eq('the reason text matches the app\'s wording',
            api.reasonOf(m({ distinctClusters: 4, maxSpreadMeters: 6200, spanMs: 5 * 60 * MIN, sessions: 2 }), sig('apple_find_my')),
            'Seen at 4 locations up to 6.2km apart over 5h in 2 separate visits; matches Apple Find My format');

        // FlagDecision
        const flagged = { flagged: true, placeIds: [1, 2, 3] };
        const quiet = { flagged: false, placeIds: [1, 2, 3] };
        t.eq('first flag: raise', api.decide(flagged, null, null), 'raise');
        t.eq('below the threshold with no flag: suppress', api.decide(quiet, null, null), 'suppress');
        t.eq('active flag still flagged: update', api.decide(flagged, { active: true, dismissedPlaces: [] }, null), 'update');
        t.eq('dismissed, then seen only at the same places: suppress', api.decide(flagged, { active: false, dismissedPlaces: [1, 2, 3] }, { flagged: true, placeIds: [1, 2, 3] }), 'suppress');
        t.eq('dismissed, then flagged again including a new place: raise', api.decide(flagged, { active: false, dismissedPlaces: [1, 2, 3] }, { flagged: true, placeIds: [2, 3, 4] }), 'raise');

        // Map tiles: Web Mercator, 256 px tiles.
        const origin = api.project(0, 0, 0);
        t.ok('lat 0, lon 0 is the centre of the zoom-0 tile (128, 128)', Math.abs(origin.x - 128) < 1e-9 && Math.abs(origin.y - 128) < 1e-9);
        const one = api.tileLayout([{ lat: 26.1, lon: -81.8 }], 360, 260);
        t.eq('a single place is shown at zoom 16', one.zoom, 16);
        t.ok('every tile comes from tile.openstreetmap.org', one.tiles.length > 0 && one.tiles.every((x) => /^https:\/\/tile\.openstreetmap\.org\/16\/\d+\/\d+\.png$/.test(x.url)));
        t.ok('the marker sits in the middle of the map', Math.abs(one.markers[0].left - 180) < 1e-6 && Math.abs(one.markers[0].top - 130) < 1e-6);

        t.section('Hot/cold finder (ProximityTracker)');

        const track = { key: 'k', signatureId: 'apple_find_my', lastAddress: 'A1', lastSeen: 0, lastRssi: -80, lastLat: null, lastLon: null, lastStatus: null };
        const prox = api.createProximity(track);
        const read = (ts, rssi, address = 'A1') => prox.onReading({ address, signatureId: 'apple_find_my', rssi, ts, lat: null, lon: null, status: null });
        let r = read(1000, -80);
        t.eq('the first reading is taken as is', r.smoothedRssi, -80);
        t.eq('-80 dBm is "in range"', r.band, 'in range');
        r = read(2000, -60);
        t.eq('smoothing: -80 + 0.3 × (-60 - -80) = -74', r.smoothedRssi, -74);
        read(3000, -60);
        r = read(4500, -60);
        t.eq('3 s of stronger readings: warmer', r.trend, 'warmer');
        // More than 12 dB from the target's last reading, so the linker can't take it for the
        // target after an address change (within 12 dB it would, exactly as RotationLinker does).
        r = read(4600, -85, 'OTHER');
        t.eq('another address of the same family, 25 dB away, counts as another device nearby', r.othersNearby, 1);
        r = prox.snapshot(4500 + 20001);
        t.ok('no reading for 20 s: lost, "not heard"', r.lost && r.band === 'not heard');

        t.section('A scripted day: a tag follows you, an iPhone and a router don\'t');

        const base = Date.now() - 3 * 60 * MIN;
        const tag = (id, rssi = -62) => event(window, { id, rssi, name: '', manufacturer: { 0x004C: [0x12, 0x19, 0x10, 0x01] } });
        const phone = () => event(window, { id: 'PHONE', rssi: -50, name: 'My iPhone', manufacturer: { 0x004C: [0x10, 0x05, 0x01] } });
        const router = () => event(window, { id: 'ROUTER', rssi: -70, name: '<img src=x onerror="window.__pwned=1">' });
        const cycle = (minutes, place, advs) => {
            const ts = base + minutes * MIN;
            api.setFix({ ...PLACE[place], acc: 20, ts });
            for (const a of advs) api.handleAdvertisement(a, ts);
            api.runCycle(ts);
        };

        cycle(0, 'A', [tag('A1'), phone(), router()]);
        cycle(10, 'B', [tag('A1', -64), phone()]);
        cycle(25, 'C', [tag('A2', -66), phone()]); // the tag's Chrome ID changed

        const devs = Array.from(api.state.devices.values());
        const tags = devs.filter((d) => d.signatureId === 'apple_find_my');
        t.eq('three places were recorded', api.state.clusterer.all.length, 3);
        t.eq('the tag is one device despite the new Chrome ID', tags.length, 1);
        t.eq('…with both IDs linked to it', tags[0]?.ids.size, 2);
        const tagFlag = api.state.flags.get(tags[0]?.key);
        t.ok('the tag is flagged', !!tagFlag && tagFlag.active);
        // 3 places → 15; A to C is 6.0 km → spread capped at 20; one visit → 0; Find My → 35.
        t.eq('its score is 15 + 20 + 0 + 35 = 70', tagFlag?.score, 70);
        t.eq('its reason names the places, distance, span and format', tagFlag?.reason, 'Seen at 3 locations up to 6.0km apart over 25min; matches Apple Find My format');
        const phoneDev = devs.find((d) => d.ids.has('PHONE'));
        // Same places and span, no signature, Chrome ID only but 25 min ≤ 30 min: 15 + 20 = 35 < 55.
        t.ok('the iPhone went to the same places but scores 35 and isn\'t flagged', !!phoneDev && !api.state.flags.has(phoneDev.key));
        const routerDev = devs.find((d) => d.ids.has('ROUTER'));
        t.ok('the router, seen at one place only, isn\'t flagged', !!routerDev && !api.state.flags.has(routerDev.key));

        t.section('Screens');

        api.showView('flagged');
        const cards = document.querySelectorAll('#view .card');
        t.eq('the Flagged screen lists one card', cards.length, 1);
        t.ok('…titled with the tracker family', /Apple Find My/.test(cards[0]?.textContent || ''));
        t.ok('the Flagged tab shows a count of 1', document.querySelector('#tab-flagged .count')?.textContent === '1');

        api.openDetail(tags[0].key);
        const view = document.getElementById('view');
        t.ok('Device Detail shows a "Find it" button for an active flag', Array.from(view.querySelectorAll('button')).some((b) => b.textContent === 'Find it'));
        t.eq('Device Detail lists the three places', view.querySelectorAll('table.places tbody tr').length, 3);
        const tiles = Array.from(view.querySelectorAll('.map img'));
        t.ok('the map is made of OpenStreetMap tiles only', tiles.length > 0 && tiles.every((i) => i.getAttribute('src').startsWith('https://tile.openstreetmap.org/')));
        t.eq('three numbered markers', view.querySelectorAll('.map .marker').length, 3);
        t.ok('the map credits OpenStreetMap, opening in a new tab without a referrer', !!view.querySelector('a[href="https://www.openstreetmap.org/copyright"][target="_blank"][rel="noopener noreferrer"]'));

        api.openDetail(routerDev.key);
        t.ok('an advertised name with markup is shown as text', view.textContent.includes('<img src=x onerror="window.__pwned=1">'));
        t.ok('…and creates no element or handler', !view.querySelector('img[onerror]') && window.__pwned === undefined);
        t.ok('no "Find it" for a device that isn\'t flagged', !Array.from(view.querySelectorAll('button')).some((b) => b.textContent === 'Find it'));

        const now = Date.now();
        api.handleAdvertisement(tag('A2', -58), now);
        api.handleAdvertisement(phone(), now);
        api.runCycle(now);
        api.showView('nearby');
        const rows = document.querySelectorAll('#view .row');
        t.eq('Nearby lists the two devices heard in the last minute', rows.length, 2);
        t.ok('…tracker first, with its family tag', rows[0]?.classList.contains('tracker') && /Apple Find My/.test(rows[0].textContent));

        t.section('Device swarm (the 3JS gallery\'s 3.3 Particle Swarm, around you)');

        t.ok('no swarm while not scanning', !document.querySelector('#view .swarm'));
        api.state.scanning = true;   // jsdom can't really scan, so switch the state on directly
        api.render();
        const swarmEl = document.querySelector('#view .swarm');
        t.ok('scanning shows the swarm on Nearby', !!swarmEl);
        t.ok('…at the top, above the device list', document.getElementById('view').firstElementChild === swarmEl);
        const canvas = swarmEl?.querySelector('canvas');
        t.eq('the canvas is labelled as an image', canvas?.getAttribute('role'), 'img');
        t.eq('its label counts the devices, trackers and flags', canvas?.getAttribute('aria-label'),
            '2 devices around you: 1 tracker, 1 flagged. Stronger signals orbit closer to the centre.');
        t.ok('the legend names all four colours', ['You', 'Device', 'Tracker', 'Flagged'].every((w) => swarmEl.querySelector('.legend').textContent.includes(w)));
        api.render();
        t.ok('re-rendering keeps the same swarm element (the animation carries on)', document.querySelector('#view .swarm') === swarmEl);
        t.eq('jsdom has no 2D canvas, so no animation frame is requested', api.swarm.raf, 0);
        const kinds = api.swarmDevices(Date.now()).map((d) => d.kind).sort().join(',');
        t.eq('the tag is drawn as flagged and the iPhone as a plain device', kinds, 'device,flagged');

        // Orbit radius: linear from 0.55 at -45 dBm to 1.8 at -95 dBm (the gallery's outer radius).
        t.eq('-45 dBm orbits at 0.55', api.rssiToRadius(-45), 0.55);
        t.eq('-95 dBm orbits at 1.8', api.rssiToRadius(-95), 1.8);
        t.ok('-70 dBm is halfway: 0.55 + 0.5 × 1.25 = 1.175', Math.abs(api.rssiToRadius(-70) - 1.175) < 1e-12);
        t.ok('stronger than -45 and weaker than -95 are clamped', api.rssiToRadius(-20) === 0.55 && api.rssiToRadius(-120) === 1.8);
        t.eq('a device keeps the same orbit every time', JSON.stringify(api.deviceOrbit('A2')), JSON.stringify(api.deviceOrbit('A2')));
        t.ok('different devices get different orbits', api.deviceOrbit('A2').theta !== api.deviceOrbit('PHONE').theta);
        const focal = api.fitScale(800, 460);
        const centre = api.projectPoint(0, 0, 0, 1.3, 800, 460, focal);
        t.ok('you are drawn at the centre of the canvas', Math.abs(centre.x - 400) < 1e-9 && Math.abs(centre.y - 230) < 1e-9);
        let inside = true;
        for (let i = 0; i < 360; i += 5) {
            const a = i * Math.PI / 180;
            const p = api.projectPoint(1.8 * Math.cos(a), 0, 1.8 * Math.sin(a), 0, 800, 460, focal);
            if (p.x < api.SWARM.pad - 1 || p.x > 800 - api.SWARM.pad + 1 || p.y < api.SWARM.pad - 1 || p.y > 460 - api.SWARM.pad + 1) inside = false;
        }
        t.ok('the outer orbit fits inside the canvas padding', inside);

        api.state.scanning = false;
        api.render();
        t.ok('stopping hides the swarm again', !document.querySelector('#view .swarm'));

        t.section('Ignoring');

        api.ignoreDevice(phoneDev.key, false);
        t.eq('an ignored device drops off Nearby', document.querySelectorAll('#view .row').length, 1);
        t.ok('…with a note that it\'s hidden', /1 ignored device hidden/.test(document.getElementById('view').textContent));

        t.section('Dismissing, and flagging again only at a new place');

        api.dismissFlag(tags[0].key);
        const f = api.state.flags.get(tags[0].key);
        t.ok('Dismiss clears the flag', f && !f.active);
        t.eq('…remembering the places it was seen at', f?.dismissedPlaces.slice().sort().join(','), '1,2,3');
        f.dismissedAt = base + 30 * MIN; // pretend it was dismissed half an hour into the day
        cycle(40, 'A', [tag('A2')]);
        cycle(50, 'B', [tag('A2')]);
        cycle(65, 'C', [tag('A2')]);
        t.ok('following the same round of places again stays quiet', !api.state.flags.get(tags[0].key).active);
        cycle(75, 'D', [tag('A2')]);
        t.ok('turning up at a new place flags it again', api.state.flags.get(tags[0].key).active);

        t.eq('still no console errors after all that', errors.length, 0);
        if (errors.length) t.note(errors.join('\n       '));
    } finally {
        env.close();
    }
}
