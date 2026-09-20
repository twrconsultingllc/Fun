# Working in this repo

A collection of single-file browser toys and tools, each one a self-contained
HTML file with its CSS and JavaScript inline, served from GitHub Pages at
<https://twrconsultingllc.github.io/Fun/>. `index.html` is the landing page that
links them. Keep new pages single-file unless there is a concrete reason not to.

This file is where durable guidance for this project belongs. If a working
preference comes up that should hold for future sessions, add it here so it is
committed, visible to everyone, and survives any machine being rebuilt.

When you finish a task, if you learned something durable and non-obvious that
would help a future session, say so and ask whether it belongs in this file —
don't add it unprompted.

## Deployment: verify the live site, not the commit

Work here is checked by opening the live deployed site, not by reading a diff or
a commit. **A local commit is not delivered.** Push, wait for the deploy, and
confirm what the live URL actually serves before reporting the work as done.

This rule exists because a user-guide page was once committed into
`battle-bots-V2` and reported as finished while the live app showed no such
link — the commit had never been pushed. GitHub Pages usually takes under a
minute; poll the URL rather than assuming.

One mapping trap: `index.html` used to link "AI Battle Bots" to
`fun-xi-rouge.vercel.app`, which actually served the older `battle-bots` V1
directory — the live V2 app was a separate Vercel deployment that nothing in
this repo referenced. As of 2026-09-16 the link points at `funv2.vercel.app`
(confirmed serving the V2 build). The general lesson still holds: a Vercel
project's root directory is a dashboard setting, not a file in this repo, so
fetching the landing page's link and finding the wrong version doesn't mean
the right one is unpublished — ask which URL is current rather than inferring
it from what the repo links to, and re-verify if this link is ever changed
again.

## Keep each app's user guide in sync

Some apps ship their own user-facing guide (e.g. `battle-bots-V2/public/guide.html`).
When you change that app's behavior — a default value, a formula, a skill or
weapon's effect, a new HUD element — update its guide in the same piece of
work, not as a follow-up. A guide that states the old numbers or describes
removed behavior is worse than no guide, because it reads as authoritative.
Treat this as part of the task, not an extra to ask permission for.

## Tests belong in the repo

Test suites are deliverables, not working notes. Anything worth running again
goes in the committed `tests/` directory with a README, never in a scratchpad or
`/tmp` where it disappears when the session ends. Offer this proactively rather
than waiting to be asked.

`tests/` is framework-free — plain Node plus `jsdom` — and takes a
`--target=<path|url>` argument so the same assertions run against either the
working copy or the deployed URL:

```bash
cd tests && npm install
npm test           # the working copy
npm run test:live  # what is actually deployed
```

To cover another page, add a `<page>.test.mjs` exporting `name` and a default
`run(harness, page)` function, then register it in the `SUITES` array in
`tests/run.mjs`. See `tests/README.md` for the harness API and conventions.

When a test fails, re-derive the expected value from first principles before
changing it. Do not "fix" a failure by pasting in whatever the page now prints —
during the TriCalc 4.0 rewrite three failures turned out to be wrong
expectations in the test, but the fourth would have papered over a real bug.

### Testing a multi-file app (battle-bots-V2)

`battle-bots-V2` is not a single-file page — it's `public/*.js` ES modules
plus an `api/` serverless function, deployed separately on Vercel rather than
GitHub Pages. `battle-bots-v2.core.test.mjs` and `battle-bots-v2.dom.test.mjs`
cover it, but the pattern is different enough from the single-file suites
that it's worth knowing before reaching for `chromium-cli` or a real browser:

- **`chromium-cli` was not installed in this environment**, and neither is a
  local `canvas` npm package, so jsdom's `getContext('2d')` returns `null`.
  `battle-bots-V2/public/main.js` calls `paintIdleArena()` at import time,
  which uses that context immediately — so loading the real page in jsdom
  with scripts enabled throws before anything else runs. Verify this app's
  logic by `import()`-ing its ES modules directly (`entities.js`, `skills.js`,
  `state.js` have no DOM dependency at all) rather than trying to run the
  whole page.
- There's no `window.__pagename` hook here (unlike `ai-swarm.html` /
  `race-day.html`), so a DOM-level check imports `ui.js` directly against a
  `runScripts: 'outside-only'` jsdom document instead of letting `main.js`
  run. See the comments at the top of `battle-bots-v2.dom.test.mjs`.
- `npm run test:live`'s GitHub Pages base actually does reach these files
  (the whole repo is published there) — it just never exercises the real
  `/api/get-actions` route, which only exists on Vercel. To test the actual
  running app, target it directly: `--target=https://<live-url>/index.html`.
  `lib/bots-modules.mjs` stages a remote target's files into a temp dir
  first, since Node's loader can't resolve one module's relative import of
  another against an `https:` URL.

### Recycling scenery in race-day.html

`race-day.html`'s world scrolls by jumping fixed props forward once they fall
behind the athlete (`recycle()`/`recycleGroup()`). For a *tiled* group (palms,
dashes, skyline) almost any margin works, because neighbouring tiles cover the
seam. A *single* recycled object with no neighbour — like the road deck — only
gets a gapless jump if the margin equals exactly half its span; anything else
opens a real gap at every recycle, and increasing the margin makes a
too-small gap *worse*, not better, since it's the wrong direction. This is
easy to get backwards by intuition (as happened once already) — simulate the
actual `recycle()` math in Node against a few margins before changing one,
rather than reasoning about it in the abstract.

## New pages get a numbered security & quality review

When a new page (or a small batch of related pages) is added to this repo,
review it for security and code-quality issues before calling the work done,
fix what can be fixed, and publish the result as the next sequentially
numbered report in `tests/secrpts/` (`01.html` is the original site-wide
scan; `02.html` reviewed the four pattern-lab pages — follow that file's
format: CSP/referrer/description meta tags on the report itself, a progress
bar, Security and Code quality sections, each finding tagged Fixed/Open/
Partial). Verify claims instead of assuming them — e.g. compute WCAG
contrast ratios rather than eyeballing colors, grep for the bug pattern
instead of asserting it isn't there. Note honestly what's left open and why
(architecturally blocked, e.g. no GitHub Pages equivalent for a header-only
policy, vs. simply not fixed yet) — a badge that says "Fixed" without a real
fix behind it is worse than an honest "Open."

This applies to any new page, including reference/study material under
`study/` that isn't part of the toy gallery — being off `index.html` doesn't
exempt a page from this, since it's still served from GitHub Pages and still
worth getting right.

## `tests/secrpts/` reports follow a fixed template — they don't need their own review

A numbered report in `tests/secrpts/` is itself a new page, and reviewing a
report about a report about a report is a real trap — something has to
break that cycle. The fix is to make every report structurally incapable of
introducing a vulnerability in the first place, so no report ever needs a
numbered review of its own. Every `tests/secrpts/NN.html` must:

- Carry exactly this head block: UTF-8 charset, a `viewport` meta,
  `referrer` set to `strict-origin-when-cross-origin`, this exact CSP —
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  font-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none';
  base-uri 'none'; form-action 'self'` — and a `description` meta tag
  specific to that report. Don't add `data:` to `img-src` or widen anything
  else unless a report genuinely embeds an image (none has so far).
- Have zero `<script>` tags, inline or external, and zero inline event
  handlers (`on*="…"`) — these are pure static HTML/CSS documents.
- Load nothing from outside the repo: no external `<link>`, no CDN font or
  script, no `@import`, no off-origin `url(...)` in CSS.
- Have no `<form>` — a report has nothing to submit.
- Only cross-link to other files in the same `tests/secrpts/` directory, as
  a plain relative `href="NN.html"` — same-origin, same-tab, no
  `target`/`rel` hardening needed. If a report needs to mention an external
  URL from a page it reviewed (e.g. the NMLS link), write it as inert text
  inside `<code>`, never as a real `<a href>` to that origin.
- Style only through a `<style>` block in `<head>` using CSS custom
  properties with a `prefers-color-scheme: dark` override, matching
  `01.html`'s pattern — no inline `style="…"` attribute may introduce a new
  color; layout-only inline styles (`grid-column`, `margin-top`) are fine.

A report that follows this template has no path to a new vulnerability by
construction, so it's exempt from the "new pages get a numbered review" rule
above — publishing `06.html` doesn't require a `07.html` to review it. What
still needs doing per report is the actual work the report exists to do
(verifying the claims it makes about the pages it's reviewing), not a
security check of the report file itself.

## No browser or WebGL rendering in this environment

There is no puppeteer, chromium-cli, or connected claude-in-chrome browser in
this sandbox — nothing that can load a page and take a real screenshot. This
is the same root cause already noted under battle-bots-V2 (`getContext('2d')`
returns null in jsdom), but it's an environment-wide fact, not specific to
that app: it applies to every three.js/WebGL page in this repo (race-day.html
included). Visual changes to a 3D scene can't be screenshotted here — verify
them by running the no-WebGL test suite (these pages are built to degrade to
a DOM-only quiz/UI with no renderer, which is exactly what jsdom exercises)
and, for anything geometry/timing-related, by simulating the actual math in
Node rather than eyeballing it. Say so explicitly rather than claiming a
visual check that didn't happen, and ask the user to eyeball the real result
once it's deployed.

## Do not judge third-party model IDs from memory

An unfamiliar model ID is far more likely to be newer than the training cutoff
than to be a typo. Never tell the user a third-party model ID is invalid,
nonexistent, or hallucinated on the strength of recall alone.

This came up when `gemini-3.5-flash` was flagged as "wrong / nonexistent" in the
battle-bots Gemini app; the user then asked for `gemini-3.5-flash-lite` as the
default, so that family plainly does exist.

Instead:

- Check the provider's live catalog. This project already calls
  `GET https://generativelanguage.googleapis.com/v1beta/models`.
- If checking is not possible, raise it as a question ("can you confirm this ID
  is current?"), not as a finding.
- Prefer code that resolves a model against the live catalog at runtime with a
  graceful fallback over code that hardcodes an ID believed to be correct.
- It is still fair to flag a hardcoded fallback ID as *fragile* — one
  unverifiable constant that breaks every call if wrong. Frame that as the
  brittleness of the pattern, not as a claim that the ID is fake.
