#!/usr/bin/env node
/* My Daily Wire — feed fetcher.
 *
 * Runs in GitHub Actions (.github/workflows/daily-wire.yml) every 6 hours:
 * fetches every feed in feeds.config.json, reduces each item to plain text
 * plus a vetted link and image, and writes feeds.json for daily-wire.html.
 *
 *   node fetch-feeds.mjs                 # fetch and write feeds.json
 *   node fetch-feeds.mjs --dry-run       # fetch and print a summary only
 *
 * The page never sees raw feed markup. Everything it renders comes from
 * normalizeFeed() below: titles and summaries are stripped to plain text,
 * links must be http(s), and images must be https on a host listed in
 * config.imageHosts (the same list the page's CSP allows).
 *
 * feeds.json is only rewritten when its content changes, so a run that
 * finds no new headlines leaves the file alone and the workflow makes no
 * commit.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

const HERE = new URL('./', import.meta.url);
const USER_AGENT = 'MyDailyWire/1.0 (personal feed reader; +https://github.com/twrconsultingllc/Fun)';
const FETCH_TIMEOUT_MS = 20000;
const MAX_BYTES = 5 * 1024 * 1024;
const TITLE_MAX = 220;
const SUMMARY_MAX = 280;

/* ---------- text ---------- */

const NAMED_ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', bull: '•', middot: '·',
    copy: '©', reg: '®', trade: '™', eacute: 'é', egrave: 'è', aacute: 'á', oacute: 'ó',
    iacute: 'í', uacute: 'ú', ntilde: 'ñ', uuml: 'ü', ouml: 'ö', auml: 'ä', ccedil: 'ç',
    deg: '°', times: '×', pound: '£', euro: '€', cent: '¢', laquo: '«', raquo: '»'
};

export function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (m, body) => {
        if (body[0] === '#') {
            const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
            return String.fromCodePoint(code);
        }
        const named = NAMED_ENTITIES[body.toLowerCase()];
        return named === undefined ? m : named;
    });
}

/* Feed text is often HTML, sometimes entity-escaped HTML, and now and
   then escaped twice. Decode, strip tags, and repeat until nothing changes,
   so an escaped tag can't survive as a real one. Any '<' or '>' left after
   that is dropped too. The result is plain text only. */
export function stripMarkup(s) {
    for (let pass = 0; pass < 5; pass++) {
        const before = s;
        s = decodeEntities(s);
        s = s.replace(/<(script|style|iframe|object|noscript)\b[\s\S]*?<\/\1[^>]*>/gi, ' ');
        s = s.replace(/<!--[\s\S]*?-->/g, ' ');
        s = s.replace(/<\/?(p|div|br|li|h[1-6]|tr|blockquote)\b[^>]*>/gi, ' ');
        s = s.replace(/<[a-z!?/][^>]*>/gi, ''); // a tag starts <letter, <!, <? or </
        if (s === before) break;
    }
    return s.replace(/[<>]/g, '');
}

export function toPlainText(value, max = SUMMARY_MAX) {
    let s = stripMarkup(textOf(value));
    s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200d\u2028\u2029\ufeff]/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    return truncate(s, max);
}

export function truncate(s, max) {
    const chars = Array.from(s);
    if (chars.length <= max) return s;
    let cut = chars.slice(0, max - 1).join('');
    const space = cut.lastIndexOf(' ');
    if (space > max * 0.6) cut = cut.slice(0, space);
    return cut.replace(/[\s,;:.–—-]+$/, '') + '…';
}

/* The parser returns a string, a number, an object with '#text', or an
   array of those. Reduce any of them to one string. */
export function textOf(v) {
    if (v == null) return '';
    if (Array.isArray(v)) return textOf(v[0]);
    if (typeof v === 'object') return textOf(v['#text']);
    return String(v);
}

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/* ---------- URLs ---------- */

export function safeLink(raw, base) {
    const s = decodeEntities(textOf(raw)).trim();
    if (!s) return null;
    let url;
    try { url = new URL(s, base); } catch { return null; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.href;
}

export function hostAllowed(host, allowList) {
    host = host.toLowerCase();
    return allowList.some((entry) => {
        entry = entry.toLowerCase();
        if (entry.startsWith('*.')) return host.endsWith(entry.slice(1)) && host.length > entry.length - 1;
        return host === entry;
    });
}

/* An image is kept only if it is https and its host is on the allowlist.
   Anything else is reported back so the list can be extended on purpose. */
export function safeImage(raw, base, allowList, dropped) {
    const s = decodeEntities(textOf(raw)).trim();
    if (!s) return null;
    let url;
    try { url = new URL(s, base); } catch { return null; }
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (!hostAllowed(url.hostname, allowList)) {
        if (dropped) dropped[url.hostname] = (dropped[url.hostname] || 0) + 1;
        return null;
    }
    return url.href;
}

/* ---------- dates ---------- */

export function parseDate(raw, now = Date.now()) {
    const s = textOf(raw).trim();
    if (!s) return null;
    const t = Date.parse(s);
    if (!Number.isFinite(t)) return null;
    if (t < Date.UTC(1995, 0, 1)) return null;
    return new Date(Math.min(t, now)).toISOString();
}

/* ---------- parsing ---------- */

const ARRAY_TAGS = new Set(['item', 'entry', 'link', 'media:content', 'media:thumbnail', 'enclosure', 'category']);

export function makeParser() {
    return new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        // Entities are decoded by decodeEntities() instead, so a DOCTYPE in a
        // hostile feed can't declare entities that expand (no billion-laughs).
        processEntities: false,
        htmlEntities: false,
        parseTagValue: false,
        parseAttributeValue: false,
        trimValues: true,
        isArray: (tagName, _path, _leaf, isAttribute) => !isAttribute && ARRAY_TAGS.has(tagName)
    });
}

function firstImgInHtml(html) {
    const decoded = decodeEntities(textOf(html));
    const m = decoded.match(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i);
    return m ? m[1] : null;
}

function mediaUrl(node) {
    for (const m of asArray(node)) {
        if (!m || typeof m !== 'object') continue;
        const type = String(m['@_type'] || '');
        const medium = String(m['@_medium'] || '');
        if (m['@_url'] && (medium === 'image' || type.startsWith('image/') || (!type && !medium))) return m['@_url'];
    }
    return null;
}

function imageCandidates(item) {
    const group = asArray(item['media:group'])[0] || {};
    const enclosureImg = asArray(item.enclosure).find((e) => e && String(e['@_type'] || '').startsWith('image/'));
    const itunes = item['itunes:image'];
    return [
        mediaUrl(item['media:thumbnail']),
        mediaUrl(group['media:thumbnail']),
        mediaUrl(item['media:content']),
        mediaUrl(group['media:content']),
        enclosureImg && enclosureImg['@_url'],
        itunes && typeof itunes === 'object' ? itunes['@_href'] : null,
        firstImgInHtml(item['content:encoded']),
        firstImgInHtml(item.content),
        firstImgInHtml(item.description),
        firstImgInHtml(item.summary)
    ].filter(Boolean);
}

function atomLink(links) {
    const all = asArray(links).filter((l) => l && typeof l === 'object' && l['@_href']);
    const alt = all.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate');
    return alt ? alt['@_href'] : all[0] ? all[0]['@_href'] : textOf(links);
}

export function itemId(link) {
    return createHash('sha256').update(link).digest('hex').slice(0, 12);
}

/* Turn one feed document into plain items. Throws if it isn't RSS or Atom. */
export function normalizeFeed(xml, feed, config, { now = Date.now(), dropped = {} } = {}) {
    const doc = makeParser().parse(xml);
    let rawItems, isAtom = false;
    if (doc.rss && doc.rss.channel) rawItems = asArray(asArray(doc.rss.channel)[0].item);
    else if (doc['rdf:RDF']) rawItems = asArray(doc['rdf:RDF'].item);
    else if (doc.feed) { rawItems = asArray(doc.feed.entry); isAtom = true; }
    else throw new Error('not an RSS or Atom feed');

    const imageHosts = config.imageHosts || [];
    const items = [];
    const seen = new Set();
    for (const it of rawItems) {
        if (!it || typeof it !== 'object') continue;
        const link = safeLink(isAtom ? atomLink(it.link) : (textOf(it.link) || atomLink(it.link) || (it.guid && String(it.guid['@_isPermaLink']) !== 'false' ? it.guid : '')), feed.url);
        if (!link || seen.has(link)) continue;
        const title = toPlainText(it.title, TITLE_MAX);
        if (!title) continue;
        seen.add(link);
        const group = asArray(it['media:group'])[0] || {};
        const summarySource = feed.noSummary ? '' :
            it.description || it.summary || group['media:description'] || it['content:encoded'] || it.content || '';
        let summary = toPlainText(summarySource);
        if (summary === title) summary = '';
        let image = null;
        if (!feed.noImages) {
            for (const c of imageCandidates(it)) {
                image = safeImage(c, link, imageHosts, dropped);
                if (image) break;
            }
        }
        items.push({
            id: itemId(link),
            feed: feed.id,
            category: feed.category,
            source: feed.source,
            title,
            link,
            date: parseDate(it.pubDate || it.published || it.updated || it['dc:date'] || it['a10:updated'], now),
            summary,
            image
        });
    }
    return selectRecent(items, config, now);
}

/* Newest first; drop anything older than maxAgeDays, but always keep the
   newest few so a slow feed (a monthly YouTube channel) never vanishes.
   Undated items can't be judged stale, so they stay (sorted last). */
export function selectRecent(items, config, now = Date.now()) {
    const max = config.maxItemsPerFeed || 6;
    const keep = config.minItemsPerFeed || 2;
    const cutoff = now - (config.maxAgeDays || 21) * 86400000;
    const sorted = [...items].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return sorted.filter((it, i) => i < keep || !it.date || Date.parse(it.date) >= cutoff).slice(0, max);
}

/* ---------- fetching ---------- */

async function fetchText(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            redirect: 'follow',
            headers: {
                'User-Agent': USER_AGENT,
                Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5'
            }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!res.url.startsWith('https:')) throw new Error('redirected off https');
        const reader = res.body.getReader();
        const chunks = [];
        let total = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.length;
            if (total > MAX_BYTES) { controller.abort(); throw new Error('feed larger than 5 MB'); }
            chunks.push(value);
        }
        return Buffer.concat(chunks).toString('utf8');
    } catch (e) {
        throw new Error(e.name === 'AbortError' ? 'timed out' : e.message);
    } finally {
        clearTimeout(timer);
    }
}

async function mapLimit(list, limit, fn) {
    const out = new Array(list.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, list.length) }, async () => {
        while (next < list.length) { const i = next++; out[i] = await fn(list[i], i); }
    }));
    return out;
}

/* Everything except the timestamps, so "did anything change?" ignores them. */
export function contentKey(data) {
    return JSON.stringify({ categories: data.categories, feeds: data.feeds.map(({ checkedAt, ...f }) => f), items: data.items });
}

const feedInfo = (feed) => ({ id: feed.id, source: feed.source, category: feed.category, ...(feed.paywall ? { paywall: true } : {}) });

export async function build(config, previous, { fetcher = fetchText, now = Date.now() } = {}) {
    const dropped = {};
    const prevItems = new Map();
    for (const it of previous?.items || []) {
        if (!prevItems.has(it.feed)) prevItems.set(it.feed, []);
        prevItems.get(it.feed).push(it);
    }
    const checkedAt = new Date(now).toISOString();
    const results = await mapLimit(config.feeds, 6, async (feed) => {
        try {
            const items = normalizeFeed(await fetcher(feed.url), feed, config, { now, dropped });
            if (!items.length) throw new Error('no usable items');
            return { status: { ...feedInfo(feed), ok: true, count: items.length, checkedAt }, items };
        } catch (e) {
            // Keep last run's items so one bad fetch doesn't blank a section.
            const kept = prevItems.get(feed.id) || [];
            return { status: { ...feedInfo(feed), ok: false, error: String(e.message).slice(0, 120), count: kept.length, checkedAt }, items: kept };
        }
    });
    const items = results.flatMap((r) => r.items)
        .sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.id.localeCompare(b.id));
    const unique = [];
    const ids = new Set();
    for (const it of items) if (!ids.has(it.id)) { ids.add(it.id); unique.push(it); }
    return {
        data: {
            generatedAt: checkedAt,
            refreshHours: config.refreshHours,
            categories: config.categories,
            feeds: results.map((r) => r.status),
            items: unique,
            // Hosts whose images were left out; add one to imageHosts (and
            // the page's CSP) to start showing its pictures.
            imageHostsDropped: Object.keys(dropped).sort()
        },
        dropped
    };
}

async function main() {
    const dryRun = process.argv.includes('--dry-run');
    const config = JSON.parse(await readFile(new URL('feeds.config.json', HERE), 'utf8'));
    const outPath = new URL('feeds.json', HERE);
    let previous = null;
    try { previous = JSON.parse(await readFile(outPath, 'utf8')); } catch { /* first run */ }

    const { data, dropped } = await build(config, previous);
    for (const f of data.feeds) console.log(`${f.ok ? 'ok  ' : 'FAIL'} ${f.id.padEnd(22)} ${String(f.count).padStart(2)} items${f.ok ? '' : '  ' + f.error}`);
    const droppedHosts = Object.entries(dropped).sort((a, b) => b[1] - a[1]);
    if (droppedHosts.length) {
        console.log('\nImages dropped because their host is not in imageHosts:');
        for (const [h, n] of droppedHosts) console.log(`  ${h} (${n})`);
    }
    const okCount = data.feeds.filter((f) => f.ok).length;
    console.log(`\n${okCount}/${data.feeds.length} feeds ok, ${data.items.length} items`);

    if (dryRun) return;
    if (okCount === 0) {
        console.error('Every feed failed; leaving feeds.json untouched.');
        process.exitCode = 1;
        return;
    }
    if (previous && contentKey(previous) === contentKey(data)) {
        console.log('No change since the last run; feeds.json left as is.');
        return;
    }
    await writeFile(outPath, JSON.stringify(data, null, 1) + '\n');
    console.log('Wrote feeds.json');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((e) => { console.error(e); process.exitCode = 1; });
}
