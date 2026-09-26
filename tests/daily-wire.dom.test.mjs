/* daily-wire.html — My Daily Wire, the magazine-card feed reader.
 *
 * The page fetches daily-wire/feeds.json, which jsdom can't do (it has no
 * fetch), so the page falls back to its "could not be loaded" state and the
 * suite hands data in through window.__dailywire.ingest() instead, the same
 * path fetch() feeds. The data includes hostile entries, because the page
 * validates everything in feeds.json again rather than trusting the fetcher.
 *
 * The committed feeds.json and feeds.config.json are read from wherever
 * --base points, so `npm run test:live` checks the deployed copies are in
 * sync with the deployed page.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openDom } from './lib/page.mjs';

export const name = 'My Daily Wire — page';

async function fetchText(url) {
    if (url.startsWith('file:')) return readFile(fileURLToPath(url), 'utf8');
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} returned HTTP ${r.status}`);
    return r.text();
}

const NOW = Date.now();
const iso = (minsAgo) => new Date(NOW - minsAgo * 60000).toISOString();
const hex = (n) => n.toString(16).padStart(12, '0');

function sampleData() {
    const cats = ['news', 'tech', 'dev', 'science', 'security', 'live', 'fun', 'business'];
    const items = [];
    for (let i = 0; i < 40; i++) {
        const category = cats[i % cats.length];
        items.push({
            id: hex(i + 1), feed: category === 'news' && i === 0 ? 'nyt' : 'feed-' + category, category,
            source: 'Source ' + category, title: `Headline ${i} about ${category}`,
            link: `https://example.com/${category}/${i}`, date: iso(10 + i * 30),
            summary: i === 3 ? 'Mentions a unique word: zeppelin.' : 'A summary.',
            image: i === 1 ? 'https://imgs.xkcd.com/comics/a.png' : null
        });
    }
    items.push(
        { id: hex(101), feed: 'usgs', category: 'live', source: 'USGS Earthquakes', title: 'M 4.4 - Off the coast of Oregon', link: 'https://earthquake.usgs.gov/x', date: iso(5), summary: '', image: null },
        // hostile / malformed entries the page must drop or neutralise
        { id: hex(201), feed: 'evil', category: 'news', source: 'Evil', title: 'JS link', link: 'javascript:alert(1)', date: iso(1) },
        { id: hex(202), feed: 'evil', category: 'news', source: 'Evil', title: 'Data link', link: 'data:text/html,<script>alert(1)</script>', date: iso(1) },
        { id: hex(203), feed: 'evil', category: 'news', source: 'Evil', title: '<img src=x onerror="window.__pwned=1">Tagged title', link: 'https://evil.example/t', date: iso(400), summary: '<b onmouseover="window.__pwned=1">bold</b>', image: 'https://tracker.evil.example/p.gif' },
        { id: hex(204), feed: 'evil', category: 'nope', source: 'Evil', title: 'Unknown category', link: 'https://evil.example/c', date: iso(1) },
        { id: 'NOT-HEX', feed: 'evil', category: 'news', source: 'Evil', title: 'Bad id', link: 'https://evil.example/i', date: iso(1) },
        { id: hex(205), feed: 'evil', category: 'news', source: 'Evil', title: '', link: 'https://evil.example/e', date: iso(1) },
        { id: hex(206), feed: 'evil', category: 'news', source: 'Evil', title: 'http image', link: 'https://evil.example/h', date: iso(410), image: 'http://imgs.xkcd.com/a.png' },
        { id: hex(1), feed: 'dupe', category: 'news', source: 'Dupe', title: 'Duplicate id', link: 'https://evil.example/d', date: iso(1) }
    );
    return {
        generatedAt: iso(90), refreshHours: 6,
        categories: cats.map((id) => ({ id, label: id === 'dev' ? 'Dev & AI' : id[0].toUpperCase() + id.slice(1) })),
        feeds: [
            { id: 'nyt', source: 'New York Times', category: 'news', ok: true, count: 5, paywall: true },
            { id: 'sec', source: 'SEC', category: 'business', ok: false, error: 'HTTP 403', count: 0 },
            { id: 'feed-news', source: 'Source news', category: 'news', ok: true, count: 5 }
        ],
        items
    };
}

export default async function run(t, page) {
    const base = new URL('./', page.url).href;
    const config = JSON.parse(await fetchText(base + 'daily-wire/feeds.config.json'));
    const committed = JSON.parse(await fetchText(base + 'daily-wire/feeds.json'));
    const html = page.html;

    t.section('Markup and policy');
    const csp = (html.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
    const imgSrc = ((csp.match(/img-src ([^;]+)/) || [])[1] || '').split(/\s+/);
    t.ok("CSP connect-src is 'self' only (no third-party fetches)", /connect-src 'self';/.test(csp));
    t.ok("CSP has object-src 'none' and base-uri 'none'", /object-src 'none'/.test(csp) && /base-uri 'none'/.test(csp));
    t.ok('CSP img-src allows no scheme-wide source (https:, data:, *)', !imgSrc.some((s) => s === 'https:' || s === 'data:' || s === '*' || s === 'http:'));
    t.ok('referrer policy is no-referrer', /<meta name="referrer" content="no-referrer">/.test(html));
    t.ok('has a description meta', /<meta name="description" content="[^"]{40,}"/.test(html));
    t.ok('no inline event handlers', !/\son[a-z]+\s*=\s*["']/i.test(html));
    t.ok('no innerHTML / insertAdjacentHTML / document.write', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html));
    t.ok('no external script or stylesheet', !/<script[^>]+src=|<link[^>]+stylesheet/i.test(html));
    t.eq('data file path', (html.match(/DATA_URL = '([^']+)'/) || [])[1], 'daily-wire/feeds.json');

    const { window, document, errors, close } = await openDom(html, 'https://wire.test/daily-wire.html', { ignore: /fetch/i });
    try {
        const W = window.__dailywire;
        const $ = (s) => document.querySelector(s);
        const $$ = (s) => [...document.querySelectorAll(s)];
        t.eq('page script ran without errors', errors.length, 0);
        if (errors.length) t.note(errors.join('\n       '));

        t.section('Image host allowlist stays in sync');
        const cspHosts = imgSrc.filter((s) => s.startsWith('https://')).map((s) => s.slice(8)).sort().join(' ');
        t.eq('page IMAGE_HOSTS match feeds.config.json imageHosts', [...W.IMAGE_HOSTS].sort().join(' '), [...config.imageHosts].sort().join(' '));
        t.eq('CSP img-src hosts match feeds.config.json imageHosts', cspHosts, [...config.imageHosts].sort().join(' '));

        t.section('No data (jsdom has no fetch)');
        t.ok('notice says headlines could not be loaded', !$('#notice').hidden && /could not be loaded/.test($('#noticeTitle').textContent));
        t.eq('no cards', $$('.card').length, 0);
        W.ingest(committed);
        t.ok('committed feeds.json is valid JSON with an items array', Array.isArray(committed.items));
        if (committed.items.length === 0) {
            t.ok('placeholder feeds.json shows "No headlines yet"', /No headlines yet/.test($('#noticeTitle').textContent));
            t.eq('placeholder stamp says it is waiting', $('#stamp').textContent, 'Waiting for the first update');
        } else {
            t.ok('committed feeds.json renders cards', $$('.card').length > 0);
            t.ok('every committed image is on the allowlist (page kept them all)', committed.items.filter((i) => i.image).length === W.state.items.filter((i) => i.image).length);
        }

        t.section('Rendering sample data');
        W.ingest(sampleData());
        const items = W.state.items;
        // 40 sample + quake + the two hostile-but-valid entries (tagged title,
        // http image), which render with their HTML as text and no image.
        t.eq('malformed entries dropped (43 remain)', items.length, 43);
        t.ok('no javascript:/data: link reached the page', $$('a').every((a) => /^(https?:|index\.html)/.test(a.getAttribute('href'))));
        t.eq('first page shows 30 cards', $$('.card').length, 30);
        t.ok('"Show more" visible with the remaining count', !$('#more').hidden && $('#more').textContent === 'Show more (13 left)');
        $('#more').click();
        t.eq('Show more reveals the rest', $$('.card').length, 43);
        t.ok('Show more then hides', $('#more').hidden);
        t.eq('newest first (the 5-min-old quake leads)', $$('.card h2')[0].textContent, 'M 4.4 - Off the coast of Oregon');
        const tagged = $$('.card').find((c) => c.querySelector('h2').textContent.includes('Tagged title'));
        t.ok('HTML in a title is shown as text, never parsed', tagged && tagged.querySelector('h2').textContent.startsWith('<img src=x') && !tagged.querySelector('h2 img'));
        t.ok('HTML in a summary is shown as text', tagged && tagged.querySelector('.summary').textContent.startsWith('<b onmouseover'));
        t.ok('no injected handler ever ran', window.__pwned === undefined);
        t.ok('off-list image host rendered as a panel, not an <img>', tagged && !tagged.querySelector('img') && tagged.querySelector('.panel'));
        const httpImg = $$('.card').find((c) => c.querySelector('h2').textContent === 'http image');
        t.ok('http:// image refused by the page', httpImg && !httpImg.querySelector('img'));
        const xk = $$('.card img');
        t.eq('exactly one real image (the allowed https one)', xk.length, 1);
        t.eq('image src is the allowed URL', xk[0] && xk[0].getAttribute('src'), 'https://imgs.xkcd.com/comics/a.png');
        t.eq('image sends no referrer', xk[0] && xk[0].referrerPolicy, 'no-referrer');
        t.eq('image loads lazily', xk[0] && xk[0].getAttribute('loading'), 'lazy');
        const a0 = $('.card h2 a');
        t.eq('story links open in a new tab', a0.target, '_blank');
        t.eq('story links carry noopener noreferrer', a0.rel, 'noopener noreferrer');
        t.eq('quake card panel shows its magnitude', $$('.card')[0].querySelector('.panel .big').textContent, 'M 4.4');
        const nyt = $$('.card').find((c) => c.querySelector('h2').textContent === 'Headline 0 about news');
        t.ok('paywalled feed gets a Paywall pill', nyt && nyt.querySelector('.pill') && nyt.querySelector('.pill').textContent === 'Paywall');
        t.ok('non-paywalled cards have no pill', $$('.card .pill').length === 1);
        t.ok('stamp shows the update time and cadence', /^Updated .+ · checks every 6 h$/.test($('#stamp').textContent));
        t.ok('feed status counts 2 of 3 updated', $('#statusSummary').textContent === 'Feed status: 2 of 3 updated on the last run');
        t.ok('failed feed listed with its error', $$('#feedList .bad').some((li) => li.textContent === '✗ SEC — HTTP 403'));

        t.section('Filtering');
        const chip = (cat) => $(`.chip[data-cat="${cat}"]`);
        t.eq('nine chips (All + 8 categories)', $$('.chip').length, 9);
        t.eq('Live data chip counts 6 (5 sample + quake)', chip('live').querySelector('.n').textContent, '6');
        chip('live').click();
        t.ok('Live data chip pressed', chip('live').getAttribute('aria-pressed') === 'true' && chip('all').getAttribute('aria-pressed') === 'false');
        t.ok('only Live data cards shown', $$('.card').length === 6 && $$('.card').every((c) => c.classList.contains('c-live')));
        chip('all').click();
        const search = $('#search');
        search.value = 'ZEPPELIN';
        search.dispatchEvent(new window.Event('input'));
        await new Promise((r) => setTimeout(r, 200));
        t.eq('search is case-insensitive and matches summaries', $$('.card').length, 1);
        search.value = 'zzzz-no-match';
        search.dispatchEvent(new window.Event('input'));
        await new Promise((r) => setTimeout(r, 200));
        t.ok('no match shows a "Nothing matches" notice', !$('#notice').hidden && $('#noticeTitle').textContent === 'Nothing matches');
        search.value = '';
        search.dispatchEvent(new window.Event('input'));
        await new Promise((r) => setTimeout(r, 200));

        t.section('Read tracking');
        const firstCard = $('.card');
        const firstId = firstCard.dataset.id;
        firstCard.querySelector('h2 a').addEventListener('click', (e) => e.preventDefault());
        firstCard.querySelector('h2 a').click();
        t.ok('opening a story dims its card', firstCard.classList.contains('read'));
        const stored = JSON.parse(window.localStorage.getItem('dailyWire.read.v1'));
        t.ok('read id saved to localStorage', Array.isArray(stored) && stored.includes(firstId));
        $('#unread').click();
        t.eq('Unread only toggle pressed', $('#unread').getAttribute('aria-pressed'), 'true');
        t.ok('Unread only hides the read story', !$$('.card').some((c) => c.dataset.id === firstId) && $$('.card').length === 30);
        $('#markAll').click();
        t.eq('Mark shown as read clears the first page (1 + 30 read)', W.state.items.filter((i) => !W.state.read.has(i.id)).length, 43 - 31);
        $('#unread').click();
        W.render();
        t.ok('read cards come back when the toggle is off', $$('.card.read').length >= 30);

        t.section('SW FL category');
        W.ingest({
            generatedAt: iso(5), refreshHours: 6, categories: config.categories, feeds: [],
            items: [
                { id: hex(301), feed: 'gn-naples', category: 'swfl', source: 'Naples Daily News', title: 'County approves beach plan', link: 'https://news.google.com/rss/articles/x1', date: iso(20), summary: '', image: null },
                { id: hex(302), feed: 'nws-swfl', category: 'swfl', source: 'NWS alerts: Collier & Lee', title: 'Rip Current Statement issued September 26 by NWS Miami', link: 'https://api.weather.gov/alerts/x2', date: iso(10), summary: '', image: null },
                { id: hex(303), feed: 'bbc-world', category: 'news', source: 'BBC News', title: 'World story', link: 'https://example.com/w', date: iso(30), summary: '', image: null }
            ]
        });
        const chipLabels = $$('.chip').map((c) => c.firstChild.textContent);
        t.eq('SW FL is the first chip after All', chipLabels.slice(0, 2).join(' | '), 'All | SW FL');
        chip('swfl').click();
        t.ok('SW FL chip shows only SW FL cards, with the SW FL colour class', $$('.card').length === 2 && $$('.card').every((c) => c.classList.contains('c-swfl')));
        t.eq('card shows the real publisher', $$('.card')[1].querySelector('.meta span').textContent, 'Naples Daily News');
        t.eq('Collier/Lee weather alert gets the alert panel', $$('.card')[0].querySelector('.panel .big').textContent, 'Rip Current Statement');
        t.ok('the page defines a SW FL colour for light, device-dark and pinned-dark', (html.match(/--swfl:/g) || []).length === 3 && /\.c-swfl \{ --cat: var\(--swfl\); \}/.test(html));
        chip('all').click();

        t.section('Theme toggle');
        const root = document.documentElement;
        const themeBtn = $('#theme');
        t.eq('starts on Auto (follows the device)', themeBtn.textContent + ' / ' + (root.dataset.theme || 'none'), 'Theme: Auto / none');
        themeBtn.click();
        t.eq('first click pins Light', themeBtn.textContent + ' / ' + root.dataset.theme, 'Theme: Light / light');
        t.eq('Light is saved in this browser', window.localStorage.getItem('dailyWire.theme'), 'light');
        themeBtn.click();
        t.eq('second click pins Dark', themeBtn.textContent + ' / ' + root.dataset.theme, 'Theme: Dark / dark');
        themeBtn.click();
        t.ok('third click returns to Auto and forgets the choice', themeBtn.textContent === 'Theme: Auto' && !('theme' in root.dataset) && window.localStorage.getItem('dailyWire.theme') === null);
        const tokens = (sel) => { const i = html.indexOf(sel); const body = html.slice(html.indexOf('{', i) + 1, html.indexOf('}', i)); return body.replace(/\s+/g, ' ').trim(); };
        const deviceDark = tokens(':root:not([data-theme="light"])');
        const pinnedDark = tokens(':root[data-theme="dark"]');
        t.ok('device-dark and pinned-dark palettes are identical', deviceDark.length > 200 && deviceDark === pinnedDark);
        t.ok('device dark mode is skipped when Light is pinned', /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\)/.test(html));

        t.section('Relative time');
        const now = Date.parse('2026-09-26T18:00:00Z');
        t.eq('30 s → just now', W.ago(now - 30000, now), 'just now');
        t.eq('59 min', W.ago(now - 59 * 60000, now), '59 min ago');
        t.eq('90 min → 2 h (rounded)', W.ago(now - 90 * 60000, now), '2 h ago');
        t.eq('23 h', W.ago(now - 23 * 3600000, now), '23 h ago');
        t.eq('36 h → 2 d', W.ago(now - 36 * 3600000, now), '2 d ago');
        t.eq('10 days → a date', W.ago(now - 10 * 86400000, now), 'Sep 16');
        t.eq('no date → empty', W.ago(null, now), '');
    } finally {
        close();
    }

    t.section('Saved theme applied on load');
    for (const [saved, want] of [['dark', 'dark'], ['light', 'light'], ['<script>', 'none'], ['auto', 'none']]) {
        const w = await openDom(html, 'https://wire.test/daily-wire.html', { ignore: /fetch/i, beforeParse(win) { win.localStorage.setItem('dailyWire.theme', saved); } });
        try {
            t.eq(`saved "${saved}" → data-theme ${want}, button "${want === 'none' ? 'Auto' : want}"`,
                (w.document.documentElement.dataset.theme || 'none') + ' / ' + w.document.getElementById('theme').textContent,
                want + ' / Theme: ' + (want === 'none' ? 'Auto' : want[0].toUpperCase() + want.slice(1)));
        } finally { w.close(); }
    }

    t.section('Tampered localStorage');
    const seeded = await openDom(html, 'https://wire.test/daily-wire.html', {
        ignore: /fetch/i,
        beforeParse(w) { w.localStorage.setItem('dailyWire.read.v1', JSON.stringify(['000000000001', '<script>', 42, { a: 1 }])); }
    });
    try {
        const r = seeded.window.__dailywire.state.read;
        t.eq('only well-formed ids kept from storage', [...r].join(','), '000000000001');
        seeded.window.localStorage.setItem('dailyWire.read.v1', '{not json');
        t.eq('page still ran', seeded.errors.length, 0);
    } finally {
        seeded.close();
    }
    const corrupt = await openDom(html, 'https://wire.test/daily-wire.html', {
        ignore: /fetch/i,
        beforeParse(w) { w.localStorage.setItem('dailyWire.read.v1', '{not json'); }
    });
    try {
        t.eq('corrupt storage ignored without errors', corrupt.errors.length, 0);
        t.eq('corrupt storage → empty read set', corrupt.window.__dailywire.state.read.size, 0);
    } finally {
        corrupt.close();
    }
}
