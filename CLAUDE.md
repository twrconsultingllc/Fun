# Working in this repo

A collection of single-file browser toys and tools, each one a self-contained
HTML file with its CSS and JavaScript inline, served from GitHub Pages at
<https://twrconsultingllc.github.io/Fun/>. `index.html` is the landing page that
links them. Keep new pages single-file unless there is a concrete reason not to.

This file is where durable guidance for this project belongs. If a working
preference comes up that should hold for future sessions, add it here so it is
committed, visible to everyone, and survives any machine being rebuilt.

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
