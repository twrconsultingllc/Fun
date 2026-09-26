# My Daily Wire — feed data

`daily-wire.html` (at the repo root) is a personal news reader. It reads one
file, `daily-wire/feeds.json`, from its own site. It never fetches a feed
directly: browsers block cross-site feed requests, and the page's CSP only
allows `connect-src 'self'`.

`feeds.json` is written by `fetch-feeds.mjs`, which the
`.github/workflows/daily-wire.yml` workflow runs every 6 hours on GitHub's
servers. The workflow commits the file only when the headlines changed, as
`github-actions[bot]`, and GitHub Pages redeploys the site.

## Files

| File | What it is |
|---|---|
| `feeds.config.json` | The feed list, the categories, and `imageHosts` (the only hosts whose pictures are shown). |
| `fetch-feeds.mjs` | Fetches every feed, reduces each item to plain text plus a vetted link and image, and writes `feeds.json`. |
| `feeds.json` | Generated. Don't edit by hand; the next run overwrites it. |
| `package.json` / `package-lock.json` | The fetcher's one dependency, `fast-xml-parser` (MIT). |

## Run the fetcher yourself

It needs open internet access, so run it on your own machine or in a
Codespace. The claude.ai/code container's network policy blocks feed hosts.

```bash
cd daily-wire
npm ci
node fetch-feeds.mjs --dry-run   # fetch and print a summary, write nothing
node fetch-feeds.mjs             # fetch and write feeds.json
```

To refresh the live site without waiting, open the repo's **Actions** tab,
pick **Daily Wire feeds**, and choose **Run workflow**.

## Add or change a feed

Add an entry to `feeds` in `feeds.config.json`:

```json
{ "id": "short-id", "category": "tech", "source": "Name shown on cards", "url": "https://example.com/feed.xml" }
```

Optional flags:
- `"paywall": true` shows a Paywall pill on its cards.
- `"noImages": true` never shows its pictures.
- `"noSummary": true` never shows its summary text.

A YouTube channel's feed is
`https://www.youtube.com/feeds/videos.xml?channel_id=<the UC… id>`.

## Show pictures from a new host

Images are kept only when they are `https` and their host is listed. A new
host has to be added in **three** places, or its pictures stay hidden:

1. `imageHosts` in `feeds.config.json`
2. `IMAGE_HOSTS` in `daily-wire.html`'s script
3. `img-src` in `daily-wire.html`'s Content-Security-Policy meta tag

`tests/daily-wire.dom.test.mjs` fails if the three drift apart. Each run
lists the hosts it had to drop in `feeds.json` → `imageHostsDropped`, and in
the workflow log, so you can see what a feed wanted to show.

## When a feed fails

A failed feed keeps its items from the last successful run, so its section
doesn't go blank. The page's footer (**Feed status**) lists every feed with
its item count or its error. If every feed fails, the fetcher leaves
`feeds.json` untouched and the workflow run goes red.

GitHub turns off scheduled workflows in a public repo after 60 days with no
repository activity. If headlines stop updating, check the Actions tab and
re-enable the workflow there.
