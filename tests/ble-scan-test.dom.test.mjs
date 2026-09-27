/* ble-scan-test.html — a minimal test page for Chrome's experimental Web
 * Bluetooth scanning API (requestLEScan), written to find out whether a
 * browser version of Sentinel can scan at all.
 *
 * jsdom has no navigator.bluetooth, so this pins the "can't scan" path (the
 * checks say why and Start stays disabled) and then drives the page's own
 * advertisement handler through window.__bleScanTest with hand-built events:
 * that the tracker rules match what Sentinel's TrackerSignature.kt matches
 * (Find My 4C 00 12…, not an iPhone's other continuity messages; SmartTag by
 * service UUID; Find Hub by FEAA frame 0x40/0x41, not an ordinary Eddystone
 * beacon), and that an advertised name is rendered as text, never as HTML. */

import { openDom } from './lib/page.mjs';

export const name = 'BLE Scan Test (ble-scan-test.html)';

const BASE_UUID = (short) => `0000${short.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;

function event(window, { id, name = '', rssi = -60, manufacturer = {}, serviceData = {}, uuids = [] }) {
    const view = (bytes) => new window.DataView(new window.Uint8Array(bytes).buffer);
    const m = new window.Map(Object.entries(manufacturer).map(([k, v]) => [Number(k), view(v)]));
    const s = new window.Map(Object.entries(serviceData).map(([k, v]) => [BASE_UUID(Number(k)), view(v)]));
    return { device: { id, name }, name, rssi, manufacturerData: m, serviceData: s, uuids: uuids.map(BASE_UUID) };
}

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
    const frame = () => new Promise((resolve) => window.requestAnimationFrame(() => resolve()));

    try {
        t.section('Booting without Web Bluetooth');

        t.eq('the page has no console errors', errors.length, 0);
        if (errors.length) t.note(errors.join('\n       '));
        const checks = document.getElementById('checks').textContent;
        t.ok('the checks say Web Bluetooth is missing', /Web Bluetooth isn't available/.test(checks));
        t.ok('the checks say scanning is missing', /requestLEScan\) isn't available/.test(checks));
        t.ok('Start is disabled when the browser can\'t scan', document.getElementById('start').disabled);
        t.ok('the flag to turn on is named', /enable-experimental-web-platform-features/.test(document.getElementById('help').textContent));

        t.section('Security basics');

        const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
        t.ok('has a CSP meta tag', !!csp);
        t.ok('the CSP forbids all fetches (connect-src \'none\')', !!csp && /connect-src 'none'/.test(csp.content));
        t.eq('has a referrer policy', document.querySelector('meta[name="referrer"]')?.content, 'strict-origin-when-cross-origin');
        t.eq('loads no external scripts', document.querySelectorAll('script[src]').length, 0);

        t.section('Tracker formats match Sentinel');

        const api = window.__bleScanTest;
        const match = (opts) => api.matchSignature(api.parseAdvertisement(event(window, { id: 'x', ...opts })));
        t.eq('Apple 0x004C payload 12 19 … is Find My', match({ manufacturer: { 0x004C: [0x12, 0x19, 0x00] } }), 'Apple Find My');
        t.eq('Apple 0x004C payload 10 05 … (an iPhone nearby message) is not', match({ manufacturer: { 0x004C: [0x10, 0x05, 0x01] } }), null);
        t.eq('service UUID 0xFD5A is a Samsung SmartTag', match({ uuids: [0xFD5A] }), 'Samsung SmartTag');
        t.eq('service UUID 0xFEED is a Tile', match({ uuids: [0xFEED] }), 'Tile');
        t.eq('service UUID 0xFE33 is a Chipolo', match({ uuids: [0xFE33] }), 'Chipolo');
        t.eq('FEAA service data frame 0x41 is Google Find Hub', match({ serviceData: { 0xFEAA: [0x41, 0x00] } }), 'Google Find Hub');
        t.eq('FEAA frame 0x10 (a plain Eddystone URL beacon) is not', match({ serviceData: { 0xFEAA: [0x10, 0x00] } }), null);
        t.eq('Fast Pair 0xFE2C (ordinary earbuds) is not', match({ uuids: [0xFE2C] }), null);

        t.section('Rendering advertisements');

        api.onAdvertisement(event(window, { id: 'tag-1', rssi: -48, manufacturer: { 0x004C: [0x12, 0x19] } }));
        api.onAdvertisement(event(window, { id: 'evil', name: '<img src=x onerror=alert(1)>', rssi: -70 }));
        api.onAdvertisement(event(window, { id: 'tag-1', rssi: -45, manufacturer: { 0x004C: [0x12, 0x19] } }));
        await frame();
        await frame();

        const cards = document.querySelectorAll('#list .device');
        t.eq('one card per Chrome device ID', cards.length, 2);
        t.ok('the tracker is listed first and marked', cards[0]?.classList.contains('tracker') && /Apple Find My/.test(cards[0].textContent));
        t.ok('repeat advertisements are counted and the latest RSSI shown', /-45 dBm · 2 seen/.test(cards[0]?.textContent || ''));
        t.eq('an advertised name with markup creates no element', document.querySelectorAll('#list img').length, 0);
        t.ok('…and is shown as plain text', (cards[1]?.textContent || '').includes('<img src=x onerror=alert(1)>'));

        document.getElementById('trackersOnly').checked = true;
        document.getElementById('trackersOnly').dispatchEvent(new window.Event('change'));
        t.eq('"Trackers only" hides the other device', document.querySelectorAll('#list .device').length, 1);

        document.getElementById('clear').click();
        t.eq('Clear empties the list', document.querySelectorAll('#list .device').length, 0);
        t.eq('still no console errors after all that', errors.length, 0);
    } finally {
        env.close();
    }
}
