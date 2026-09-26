/* daily-wire/fetch-feeds.mjs — the feed fetcher behind daily-wire.html.
 *
 * The fetcher runs in GitHub Actions, not in a browser, so this suite always
 * imports the working copy's module, whatever --base points at. It feeds the
 * sample documents in fixtures/daily-wire/ (one per feed shape the config
 * uses, plus a hostile one) through normalizeFeed() and build(), with no
 * network access.
 *
 * The fetcher's one dependency (fast-xml-parser) lives in daily-wire/, so
 * that folder needs its own install first:  cd daily-wire && npm ci
 */

import { readFile } from 'node:fs/promises';

export const name = 'My Daily Wire — feed fetcher';

const ROOT = new URL('../', import.meta.url);
const fixture = (f) => readFile(new URL(`fixtures/daily-wire/${f}.xml`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-09-26T18:00:00Z');

export default async function run(t) {
    let m;
    try {
        m = await import(new URL('daily-wire/fetch-feeds.mjs', ROOT).href);
    } catch (e) {
        t.ok('fetcher module loads (run: cd daily-wire && npm ci)', false);
        t.note(e.message);
        return;
    }
    const config = JSON.parse(await readFile(new URL('daily-wire/feeds.config.json', ROOT), 'utf8'));
    const feed = (id, extra = {}) => ({ id, category: 'news', source: id, url: `https://feed.example/${id}`, ...extra });

    t.section('Config');
    const ids = config.feeds.map((f) => f.id);
    const catIds = new Set(config.categories.map((c) => c.id));
    t.eq('eight categories', config.categories.length, 8);
    t.ok('feed ids are unique', new Set(ids).size === ids.length);
    t.ok('every feed id is lowercase-kebab', ids.every((id) => /^[a-z0-9-]{2,30}$/.test(id)));
    t.ok('every feed is in a known category', config.feeds.every((f) => catIds.has(f.category)));
    t.ok('every category has at least one feed', [...catIds].every((c) => config.feeds.some((f) => f.category === c)));
    t.ok('every feed URL is https', config.feeds.every((f) => new URL(f.url).protocol === 'https:'));
    const yt = config.feeds.filter((f) => new URL(f.url).hostname === 'www.youtube.com');
    t.eq('four YouTube channels', yt.length, 4);
    t.ok('YouTube channel ids are well-formed (UC + 22 chars)', yt.every((f) => /channel_id=UC[A-Za-z0-9_-]{22}$/.test(f.url)));
    t.ok('weather alerts are for Florida', config.feeds.some((f) => f.url === 'https://api.weather.gov/alerts/active.atom?area=FL'));
    t.ok('image hosts are bare hostnames (optionally *.)', config.imageHosts.every((h) => /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)));
    t.ok('refresh is 6 hours', config.refreshHours === 6);

    t.section('RSS with media:thumbnail, content:encoded and guid');
    let dropped = {};
    const rss = m.normalizeFeed(await fixture('rss-media'), feed('rss'), config, { now: NOW, dropped });
    t.eq('duplicate link dropped (4 items → 3)', rss.length, 3);
    t.eq('CDATA title decoded to plain text', rss[0].title, 'Talks resume in Geneva & aid corridors open');
    t.eq('&amp; in the link is decoded', rss[0].link, 'https://news.example/world/1?at_medium=RSS&at_campaign=rss');
    t.eq('summary has its tags stripped', rss[0].summary, 'Negotiators say progress was made overnight.');
    t.eq('media:thumbnail image kept (allowed host)', rss[0].image, 'https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/abc/live/1.jpg');
    t.eq('<img> inside content:encoded is found', rss[1].image, 'https://media.npr.org/assets/img/2026/09/25/photo.jpg');
    t.eq('guid permalink used when <link> is missing', rss[2].link, 'https://news.example/world/3');
    t.eq('dc:date parsed', rss[2].date, '2026-09-24T12:00:00.000Z');
    t.eq('media:content medium=image used', rss[2].image, 'https://i.guim.co.uk/img/media/x/master/1.jpg?width=460');
    t.ok('newest first', rss[0].date > rss[1].date && rss[1].date > rss[2].date);
    t.ok('ids are 12 hex characters', rss.every((i) => /^[a-f0-9]{12}$/.test(i.id)));
    t.eq('id is a hash of the link (stable across runs)', rss[0].id, m.itemId(rss[0].link));

    t.section('Atom (GitHub releases)');
    dropped = {};
    const atom = m.normalizeFeed(await fixture('atom-release'), feed('rel'), config, { now: NOW, dropped });
    t.eq('alternate link used', atom[0].link, 'https://github.com/example/tool/releases/tag/v2.1.0');
    t.eq('escaped HTML content becomes plain text', atom[0].summary, "What's changed Fixed hooks & the status line");
    t.eq('avatar image dropped (host not allowed) and reported', dropped['avatars.githubusercontent.com'], 1);
    t.eq('older than 21 days: only the 2 always-kept remain', atom.length, 2);
    const noImg = m.normalizeFeed(await fixture('rss-media'), feed('x', { noImages: true }), config, { now: NOW });
    t.ok('noImages feed option drops every image', noImg.every((i) => i.image === null));

    t.section('YouTube and xkcd');
    const ytItems = m.normalizeFeed(await fixture('youtube'), feed('yt'), config, { now: NOW });
    t.eq('YouTube thumbnail from media:group (*.ytimg.com)', ytItems[0].image, 'https://i3.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
    t.eq('YouTube summary from media:description', ytItems[0].summary, 'Why does the bottom of a slinky hover in mid-air?');
    t.eq('Atom published date preferred over updated', ytItems[0].date, '2026-09-20T15:00:06.000Z');
    const xk = m.normalizeFeed(await fixture('xkcd'), feed('xkcd'), config, { now: NOW });
    t.eq('xkcd comic image from summary <img>', xk[0].image, 'https://imgs.xkcd.com/comics/error_bars.png');
    t.eq('xkcd summary is empty (only an image), not markup', xk[0].summary, '');

    t.section('Hostile feed');
    dropped = {};
    const bad = m.normalizeFeed(await fixture('hostile'), feed('evil'), config, { now: NOW, dropped });
    const links = bad.map((i) => i.link);
    t.ok('javascript: link dropped', !links.some((l) => l.startsWith('javascript')));
    t.ok('link with credentials dropped', !links.some((l) => new URL(l).username !== ''));
    t.ok('item with no title dropped', !bad.some((i) => i.link === 'https://evil.example/untitled'));
    t.eq('four items survive', bad.length, 4);
    const first = bad.find((i) => i.link === 'https://evil.example/ok');
    t.ok('no < or > survives in any title or summary', bad.every((i) => !/[<>]/.test(i.title + i.summary)));
    t.eq('double-escaped <b> in a title is stripped, not shown as a tag', first.title, 'Safe title &c;');
    t.ok('<img onerror> stripped from the title', !/onerror|<img/i.test(first.title));
    t.ok('DOCTYPE entities are NOT expanded (no billion-laughs)', first.title.length < 60 && first.title.includes('&c;'));
    t.ok('<script> and <style> contents removed from the summary', !/alert|body\{/.test(first.summary));
    t.eq('summary keeps only the visible text', first.summary, 'Visible text link');
    t.eq('future date clamped to now', first.date, new Date(NOW).toISOString());
    t.eq('tracking-pixel host dropped', first.image, null);
    t.eq('data: image dropped', bad.find((i) => i.link === 'https://evil.example/data').image, null);
    t.eq('look-alike host (imgs.xkcd.com.evil.example) dropped', bad.find((i) => i.link === 'https://evil.example/lookalike').image, null);
    t.eq('look-alike host was reported', dropped['imgs.xkcd.com.evil.example'], 1);
    const plain = bad.find((i) => i.link === 'http://evil.example/plain');
    t.eq('http image on an allowed host upgraded to https', plain.image, 'https://imgs.xkcd.com/comics/a.png');
    t.eq('unparseable date becomes null', plain.date, null);
    let threw = '';
    try { m.normalizeFeed(await fixture('xxe'), feed('xxe'), config, { now: NOW }); } catch (e) { threw = e.message; }
    t.ok('external entity (XXE) feed is refused', /external entit/i.test(threw));
    threw = '';
    try { m.normalizeFeed('<html><body>not a feed</body></html>', feed('html'), config); } catch (e) { threw = e.message; }
    t.eq('an HTML page is rejected', threw, 'not an RSS or Atom feed');

    t.section('Helpers');
    t.eq('numeric entities decoded', m.decodeEntities('&#8217;&#x2014;'), '’—');
    t.eq('invalid code points dropped', m.decodeEntities('a&#0;b&#x110000;c&#xD800;d'), 'abcd');
    t.eq('unknown named entity left alone', m.decodeEntities('&bogus;'), '&bogus;');
    t.eq('double-escaped <script> removed with its contents', m.toPlainText('&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;Hi'), 'Hi');
    t.eq('triple-escaped tag still stripped', m.toPlainText('a &amp;amp;lt;img src=x onerror=y&amp;amp;gt; b'), 'a b');
    // The script block <script>ipt>alert(1)</script> goes whole; the stray '<' of '<scr' is dropped.
    t.eq('split-up tag (<scr<script>ipt>) leaves no angle bracket or script', m.toPlainText('<scr<script>ipt>alert(1)</script>ok'), 'scr ok');
    t.eq('plain comparison text loses its angle brackets', m.toPlainText('Is 3 < 5 > 2?'), 'Is 3 5 2?');
    t.eq('truncate cuts on a word with an ellipsis', m.truncate('one two three four five six seven', 20), 'one two three four…');
    t.eq('truncate leaves short text alone', m.truncate('short', 20), 'short');
    t.ok('*.ytimg.com allows i3.ytimg.com', m.hostAllowed('i3.ytimg.com', ['*.ytimg.com']));
    t.ok('*.ytimg.com does not allow ytimg.com.evil.example', !m.hostAllowed('ytimg.com.evil.example', ['*.ytimg.com']));
    t.ok('*.ytimg.com does not allow evilytimg.com', !m.hostAllowed('evilytimg.com', ['*.ytimg.com']));
    t.eq('relative link resolved against the feed URL', m.safeLink('/story/1', 'https://feed.example/rss'), 'https://feed.example/story/1');
    t.eq('mailto: link rejected', m.safeLink('mailto:a@b.example', 'https://feed.example/'), null);
    t.eq('pre-1995 date rejected', m.parseDate('Thu, 01 Jan 1970 00:00:00 GMT'), null);

    t.section('build(): whole-run behaviour');
    const cfg = {
        ...config,
        feeds: [feed('good'), feed('flaky'), feed('broken')]
    };
    const docs = { good: await fixture('rss-media'), flaky: await fixture('youtube') };
    const run1 = await m.build(cfg, null, {
        now: NOW,
        fetcher: async (url) => { const id = url.split('/').pop(); if (!docs[id]) throw new Error('HTTP 404'); return docs[id]; }
    });
    t.eq('run 1: two feeds ok, one failed', run1.data.feeds.map((f) => f.ok).join(','), 'true,true,false');
    t.eq('run 1: failed feed records its error', run1.data.feeds[2].error, 'HTTP 404');
    t.eq('run 1: items from both good feeds', run1.data.items.length, 4);
    t.ok('run 1: items sorted newest first', run1.data.items.every((it, i, a) => i === 0 || (a[i - 1].date || '') >= (it.date || '')));
    const run2 = await m.build(cfg, run1.data, {
        now: NOW + 6 * 3600000,
        fetcher: async (url) => { if (url.endsWith('/good')) return docs.good; throw new Error('timed out'); }
    });
    t.eq('run 2: flaky feed failed but keeps last run\'s items', run2.data.items.filter((i) => i.feed === 'flaky').length, 1);
    t.eq('run 2: flaky feed status says why', run2.data.feeds[1].error, 'timed out');
    t.ok('only timestamps differ between identical runs → no commit', m.contentKey(run1.data) !== m.contentKey(run2.data)
        && m.contentKey(run1.data) === m.contentKey({ ...run1.data, generatedAt: 'x', feeds: run1.data.feeds.map((f) => ({ ...f, checkedAt: 'y' })) }));
    const paid = await m.build({ ...cfg, feeds: [feed('good', { paywall: true })] }, null, { now: NOW, fetcher: async () => docs.good });
    t.ok('paywall flag carried into the feed status', paid.data.feeds[0].paywall === true);
    t.ok('dropped image hosts listed in the output', Array.isArray(run1.data.imageHostsDropped));
}
