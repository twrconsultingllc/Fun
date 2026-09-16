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

One mapping trap: `index.html` links "AI Battle Bots" to
`fun-xi-rouge.vercel.app`, and that URL serves the older `battle-bots` V1
directory. The live V2 app is a separate deployment that nothing in this repo
references. Fetching the landing page's link and finding V1 does **not** mean V2
is unpublished. Ask which URL is current rather than inferring it from what the
repo links to — a Vercel project's root directory is a dashboard setting, not a
file in the repo.

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
