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

## Keep `study/build-plan.html` in sync while working the Claude Architect Lab

`study/build-plan.html` is the in-place progress tracker for the
`claude-architect-lab` project (see `study/plan.html` for the design it
sequences). Every session there has a `Status` badge and a "Session notes"
callout, added specifically so the plan records real progress instead of
that progress only existing in chat history.

Whenever a session from that plan gets worked on, update its entry in
`build-plan.html` as part of the same piece of work, not as a follow-up:
flip the badge (both in the session's own meta row and in the session-index
table) to `In progress` or `Done`, and write down anything that actually
happened — a version that had drifted, a decision made on the spot, a
divergence from `plan.html`, a dead end, a commit hash. Leave "None yet." in
the notes only when a session is genuinely done and nothing came up worth
recording. Treat this the same way as the user-guide-sync rule above: part
of the task, not an extra to ask permission for.

## Build plans: set off copyable commands and format links clearly

Any build plan or similar step-by-step page in this repo (`study/plan.html` /
`study/build-plan.html`, `droid/plan.html` / `droid/build-plan.html`, and
anything of the same shape added later) is meant to be worked from directly —
the user copies commands out of it into a real terminal. Two things follow
from that:

- **A command line meant to be copied and run goes in its own block**
  (`<pre><code>...</code></pre>`), not folded inline into a sentence as
  `<code>...</code>`. Inline `<code>` is still fine for a bare word, a single
  flag, a filename, or a short fragment being discussed in prose — the line
  is whether the reader is meant to select-and-copy it whole to run it.
  A command block should hold exactly the command(s) to run and nothing else
  (no leading `$`, no trailing prose folded into the same block), so a
  triple-click or select-all-in-block copies something that actually runs.
- **Every link is a real, clearly-formatted `<a href>`**, not a bare URL
  typed as text and not just a hostname mentioned in passing when the page
  means for it to be clickable — consistent with how these pages already
  cross-link each other's sections (e.g. `<a href="plan.html#order">plan.html
  section 10</a>`).

This came up when `droid/build-plan.html` needed several real shell one-liners
added (installing the Claude Code CLI, connecting to GitHub) and they were
initially just inline `<code>`, which reads fine but is awkward to copy
correctly once a command has flags or quoting in it.

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

### Run only the suites for the pages that changed

Don't run the whole suite after every change. Run only the suites for the
pages the change touched, one `--page=` run per changed page:

```bash
cd tests
node run.mjs --page=snake.html
```

A new page runs only its new suite, an edit to `snake.html` runs only the
snake suites, and an edit to `index.html` tests `index.html` (and would also
test a page it pulls in, not every page it links to). Untouched pages aren't
re-tested. The user asked for this on 2026-09-27, after a one-page addition
(`ble-scan-test.html`) was followed by a run of all 1331 assertions.

Two exceptions follow from what the suites share. An edit to `tests/lib/`
(the harness or page loader) touches every suite, so it's the one case where
`npm test` is the associated run. A Full Monty review (below) is a sitewide
re-audit and runs everything. Adding a suite's line to `SUITES` in
`tests/run.mjs` is not a shared change: run just that suite. In the review
report, name which suites ran.

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

## New pages *and* page updates get a numbered security & quality review

When a new page (or a small batch of related pages) is added to this repo,
**or an existing page gets a substantive update** — a new section, new
markup, a new link, a new inline style or script, a structural change to
what's already there — review it for security and code-quality issues
before calling the work done, fix what can be fixed, and publish the result
as the next sequentially numbered report in `tests/secrpts/` (`01.html` is
the original site-wide scan; `02.html` reviewed the four pattern-lab pages
— follow that file's format: CSP/referrer/description meta tags on the
report itself, a progress bar, Security and Code quality sections, each
finding tagged Fixed/Open/Partial). Verify claims instead of assuming them
— e.g. compute WCAG contrast ratios rather than eyeballing colors, grep for
the bug pattern instead of asserting it isn't there. Note honestly what's
left open and why (architecturally blocked, e.g. no GitHub Pages equivalent
for a header-only policy, vs. simply not fixed yet) — a badge that says
"Fixed" without a real fix behind it is worse than an honest "Open."

**Updates count, not just brand-new files.** This rule was originally
written and read as "new pages only," and in practice that let real updates
slip through with no review ever triggered — two `study/` pages
(`build-plan.html` and `agentic-plan.html`) each got substantive content
added across several separate edits (new sessions, new callouts, a whole
new section) with nothing in `tests/secrpts/` ever reviewing any of it. The
fix is this paragraph: finishing a page edit is exactly like finishing a
new page, for purposes of this rule, whenever the edit touched markup, a
link, or a style/script, not just prose wording. A pure copy fix (a typo, a
rephrased sentence, a number correction) with no markup/link/script change
doesn't need its own review — but don't use "it's just an update" as a
reason to skip one when the edit did add real content or structure, and
don't wait for a user to ask before doing it, same as the new-page case.

This applies to any page or update, including reference/study material
under `study/` that isn't part of the toy gallery — being off `index.html`
doesn't exempt a page from this, since it's still served from GitHub Pages
and still worth getting right.

## "Full Monty review" — the trigger phrase for a sitewide re-audit

The rule above ("new pages *and* page updates get a numbered review") only
ever looks at what just changed. When the user says **"let's do a full
monty review"** (or "full monty" on its own), that means something
different and broader:
review the *entire* repo again from scratch, not just recent changes —
every page, every deployed file, every subproject — and publish the result
as the next sequentially numbered `tests/secrpts/NN.html` report, in the
same format the numbered reviews already use.

A Full Monty review must always specifically check two things that are
easy to skip because they don't look like "a page":

- **The `tests/` directory itself.** GitHub Pages serves the whole repo as
  static files, so everything under `tests/` — test source, `tests/lib/`
  helpers, `tests/secrpts/` reports, `package.json`/`package-lock.json` —
  is publicly fetchable, not just the toy pages. Check it the same way any
  other page gets checked: no secrets, no tokens, no real personal data,
  and no test file that would hand an attacker something they couldn't
  already get from the toy pages themselves. Don't assume "it's just
  tests" makes it exempt.
- **The user's real email address never appears anywhere in the repo** —
  not in a file, not in a commit message, not in git's author/committer
  metadata (`git log --all --format='%ae'`), not in git history for a file
  that was later removed. Commits and pull requests from this project use
  a no-reply address instead — a Full Monty review is the point to
  actually verify that's held, not just assume it. Two author identities
  are expected, and each marks where a commit came from:
  `twrconsultingllc <328415829+twrconsultingllc@users.noreply.github.com>`
  for the Codespace and GitHub web edits, and `Claude <noreply@anthropic.com>`
  for commits made from Claude Code on the web (claude.ai/code). The user
  chose the second on 2026-09-26 so those commits can be told apart; leave
  that container's default git identity as it is. `GitHub <noreply@github.com>`
  as committer of web-UI commits is also fine. So is
  `github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>`,
  as author and committer of the "Daily Wire: refresh feeds" commits that
  `.github/workflows/daily-wire.yml` makes every 6 hours (the user agreed
  to these on 2026-09-26 when choosing the commit-based refresh for
  `daily-wire.html`). Any other address in `%ae`/`%ce` is a finding.

Beyond those two, treat it as a real from-scratch sweep, not a rubber
stamp: re-verify that prior fixes (CSP/referrer meta tags, the battle-bots
XSS fix, SRI hashes, `vercel.json` headers, `.gitignore` scope) haven't
regressed, and also look at anything that was never covered by an earlier
numbered report — small utility scripts are easy to forget precisely
because they aren't a page (the first Full Monty review, `tests/secrpts/13.html`,
found a real path-traversal bug this way in a local-dev-only script that
had never been reviewed before). Grep for the actual bug pattern and
compute real values (WCAG contrast, live `curl` checks) the same way
every other numbered review already does — a Full Monty review is not
exempt from "verify claims instead of assuming them" just because its
scope is bigger.

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
construction, so it's exempt from the "new pages *and* page updates get a
numbered review" rule above — publishing `06.html`, or later editing it
(e.g. flipping a finding from Open to Fixed), doesn't require a `07.html`
to review it. What still needs doing per report is the actual work the
report exists to do (verifying the claims it makes about the pages it's
reviewing), not a
security check of the report file itself.

## Browsers and screenshots: depends on where the session runs

Whether a real browser is available depends on the environment, so check
rather than assume:

- **The GitHub Codespace** has no puppeteer, `chromium-cli` or connected
  claude-in-chrome browser, so nothing there can load a page and take a real
  screenshot.
- **Claude Code on the web (claude.ai/code)** containers *do* ship headless
  Chromium with Playwright (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; the
  global package imports from
  `/opt/node22/lib/node_modules/playwright/index.mjs`). Don't run
  `playwright install`. There, `getContext('2d')`, `webgl` and `webgl2`
  all return real contexts (checked 2026-09-26), so a page can be loaded
  from `file://`, driven with real clicks and screenshotted. That's how
  `haunted-house.html` was checked at every scare level (`tests/secrpts/24.html`).
  The container's egress proxy blocks `cdnjs.cloudflare.com` and
  `*.github.io`, though (Google Fonts gets through). So the three.js pages
  (race-day.html and others) won't get their library from the CDN, and
  the live site can't be fetched from there, which means "verify the live
  site" has to be handed to the user.

### Headless Chromium recipes from the J.A.R.V.I.S. work (claude.ai/code)

Worked out on 2026-10-09 while building `jarvis.html`'s holo-projector and
hand control. Each one cost a failed run to discover:

- **three.js without the CDN.** cdnjs is blocked, but the npm registry isn't.
  `npm pack three@0.128.0` gives a `build/three.min.js` that is byte-identical
  to cdnjs's r128, so it matches the SRI hash the pages use. Serve it to the
  page with `page.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ path, contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } }))`,
  and the real scene renders with the integrity check still enforced. Launch
  with `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`
  for WebGL.
- **A fake camera only works with the fake-UI flag.** Launch with
  `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-video-capture=<file>.y4m`.
  Granting the camera Playwright's normal way (`permissions: ['camera']`)
  without `--use-fake-ui-for-media-stream` makes `getUserMedia` fail with
  `NotSupportedError`, which looks like a page bug but isn't. To feed it a
  picture or motion, draw frames with PIL and convert them with `ffmpeg`
  (installed) to `-pix_fmt yuv420p` `.y4m`. A permission prompt can't be
  shown headless, so test refusals by making `getUserMedia` reject with a
  `DOMException` of that name in `addInitScript`.
- **WebAssembly and model files need HTTP, not `file://`.** The MediaPipe
  hand tracker in `jarvis/hands/` fetches its `.wasm` and model, which
  `file://` can't do. Run `python3 -m http.server 8765 --bind 127.0.0.1` from
  the repo root and load `http://127.0.0.1:8765/...`. That also enforces the
  page's real CSP, so watch the console for `Refused` messages. To stop the
  server, don't `pkill -f` with its command line from the same shell command:
  the pattern matches that shell too and kills it.
- **Software rendering is far too slow for timing.** Under SwiftShader the
  hand tracker managed about one detection a second. So it can prove the
  model loads, finds hands and draws them, but not that a flick or a pinch
  registers. Test gesture logic with synthetic landmarks (see
  `tests/jarvis.dom.test.mjs`), and test the page wiring by calling its
  action handler from `page.evaluate`.
- **A fake speech recognizer must behave like the real one.** Headless
  Chromium can't run real speech recognition, so `jarvis.html`'s mic is
  tested with a fake `SpeechRecognition` in `addInitScript`. The real
  `start()` throws `InvalidStateError` if recognition is already running,
  and the page's mic button relies on that: its handler is
  `try{rec.start()}catch(e){rec.stop()}`, so a second tap stops listening.
  A fake whose `start()` never throws means the second tap never stops
  anything, and the check reports a stream left open, which looks like a
  page bug but isn't. Make the fake's `start()` throw when it's already
  running, and have it call `onstart`/`onend` asynchronously, as the real
  one does. This cost a false alarm on 2026-10-09 (Session 1 of
  `jarvis/build-plan.html`). The same applies to any browser API a page
  relies on to throw or to call back later.

Either way, jsdom itself never has a canvas (`getContext('2d')` returns null;
see battle-bots-V2 above), so the committed `tests/` suites still exercise the
no-renderer path. Where no browser is available, verify a visual change by
running the no-WebGL suite and, for anything geometry- or timing-related, by
simulating the actual math in Node. Always say plainly which kind of check
happened. A screenshot from headless Chromium counts as a visual check; a
reading of the code doesn't. Ask the user to look at the deployed result when
nothing could be rendered.

## Merge validated feature work without asking

When the user asks for a feature (or a fix) and the work has been validated,
open the pull request and merge it into `main` straight away, without asking
first. The user wants to test on the live site as soon as possible. The user
set this on 2026-10-09.

"Validated" means the usual checks for this repo have passed: the changed
pages' suites are green, any visual change was rendered (headless Chromium
where the environment has it), and the numbered review in `tests/secrpts/`
is written. If something fails, or can't be checked, don't merge. Say what's
blocking instead. Merging isn't the end: after it, follow the deployment
rule above (watch the Pages deploy, and hand the live check to the user when
the environment can't reach `*.github.io`).

## J.A.R.V.I.S.: try in `jarvis-test.html` first

Other people use `jarvis.html`, so new J.A.R.V.I.S. features never go
straight into it. Build every session from `jarvis/build-plan.html` (and
any other new feature) in `jarvis-test.html`. That's a full copy of the
page, marked TEST, with its own suite (`tests/jarvis-test.dom.test.mjs`),
linked just below J.A.R.V.I.S. on `index.html`. Merge and deploy it as
usual, so the user can try it live, and mark the session **In test** in
the build plan. The user may let several sessions stack up in the test
copy before looking. The user set this on 2026-10-09.

Only when the user says to promote does the test copy go into
`jarvis.html`. Copy it over without the TEST tag, title and description,
copy its suite over `tests/jarvis.dom.test.mjs` without the "Test copy"
section, run both suites, write a review, and flip the promoted sessions
to Done. A fix for something broken on the main page (like the mic,
review 41) goes into both copies in the same change, so they don't drift.

Never open the mic while speech recognition is running. On 2026-10-09 a
second `getUserMedia` stream, opened so the orb could follow the user's
loudness, took the mic from recognition on the user's phone. It showed
LISTENING and transcribed nothing, with no error.

A holo-projector scene that puts HTML of its own over the 3D view (labels,
buttons, an SVG overlay) must return `dispose()` from its builder and remove
that HTML there. `closeHolo()` calls it, but it can't see anything outside
the WebGL scene, so without `dispose()` the HTML stays on the page after the
scene closes. For labels that follow 3D points, reuse `layoutCallouts()`
rather than writing a new layout. It keeps labels in a column down each side,
stops them overlapping, keeps them between the top HUD and the caption, and
stops them flickering from side to side. The suit schematic (Session 3,
review 43) added both, on 2026-10-09.

Chrome stops speaking a single utterance after about 15 seconds, with no
error, and the rest of the answer is silently dropped. So everything
Jarvis says goes through `say()`, which uses `speechChunks()` to split an
answer into whole sentences of at most 160 characters and queues them.
Never call `speechSynthesis.speak()` directly for a new feature. This was
found on 2026-10-09 (review 45): the help answer had grown to about 35
seconds, and the user never heard the newest features at its end. The
chat log still showed the full text, so it looked fine on screen.
Headless Chromium has no voices, so this can't be heard in a test. The
suites check it with a fake speech engine instead, so keep that fake
behaving like the real one.

Each skin in `jarvis-test.html` (Jarvis, Morpheus, Stanley C. Panther) has
a face in the orb's centre, drawn by `orbFace()`. Each face is a picture
drawn once on a hidden canvas: the helmet and Stanley in colour, Morpheus in
grey. Every frame, it's redrawn as a grid of code characters that take their
colour or brightness from that picture, with code raining through it. To
change a face, change the picture function (`drawHelmet`, `drawMorpheus`,
`drawPanther`), not the character grid. Thin details vanish when sampled
into characters, so those functions draw trim, eyes and features thicker
for this (the `bold`/`code` options). jsdom has no canvas, so the suites
never draw a face. Check a face change with headless Chromium screenshots of
each skin. The faces were picked on 2026-10-09 (review 46).

## Long sessions: hand off with a prompt

When a session's context is getting full, finish and merge the current
piece of work rather than starting the next one. Then give the user a
ready-to-paste prompt for a fresh session, in the shape of the "Starting a
session" prompt in `jarvis/build-plan.html`. The user asked for this on
2026-10-09.

## GitHub from claude.ai/code: what it can't do

Claude Code on the web can work inside repos the user has given it, but two
things were refused on 2026-09-27 and have to be done by the user on
github.com:

- **Creating a repo.** `create_repository` returned `403 Resource not
  accessible by integration`. The user creates it at
  <https://github.com/new>. After that, `add_repo` (with push access)
  attaches it to the running session, with no restart needed, as long as
  the Claude GitHub App has access to it ("All repositories", or the new
  repo added to its selected list).
- **Deleting a remote branch.** `git push origin --delete <branch>` got
  HTTP 403 from the session's git proxy, and there's no GitHub tool for it.
  After merging a PR, tell the user to click **Delete branch** on the PR if
  they want it gone. Don't retry or look for a way around it.

Opening and merging pull requests does work, through the GitHub tools.

## My Daily Wire (`daily-wire.html`): two traps

`daily-wire.html` is a news reader whose headlines come from
`daily-wire/feeds.json`, rebuilt every 6 hours by
`.github/workflows/daily-wire.yml` running `daily-wire/fetch-feeds.mjs`
(see `daily-wire/README.md`). Two things about it aren't obvious:

- **Feeds can't be fetched from a claude.ai/code container.** Its egress
  proxy answers CONNECT 403 for news and feed hosts (BBC, NPR, xkcd,
  YouTube, nasa.gov, usgs.gov, weather.gov and the rest), and WebFetch was
  refused for them too when this page was built on 2026-09-26. Only
  `github.com` got through. So `node fetch-feeds.mjs` and any "is this feed
  URL still valid?" check can't run there. Test the fetcher against the
  sample documents in `tests/fixtures/daily-wire/` (the `wire-core` suite)
  and treat a real run as the check: the Actions workflow (run by hand from
  the Actions tab), or `node fetch-feeds.mjs --dry-run` in the Codespace.
  After a real run, the page footer's "Feed status" and `feeds.json` →
  `imageHostsDropped` show which feeds failed and which image hosts were
  refused.
- **An image host has to be listed in three places.** Pictures show only
  if their host is in `imageHosts` in `daily-wire/feeds.config.json`,
  `IMAGE_HOSTS` in `daily-wire.html`'s script, *and* `img-src` in that
  page's CSP meta tag. Miss one and the pictures silently don't appear:
  the fetcher drops them, the page refuses them, or the browser blocks
  them, and none of those shows an error. `wire-dom` fails when the three
  lists drift apart, so run `npm test` after touching any of them.
- **Don't add `-site:` exclusions to the Google News searches.** The SW FL
  category's four searches (`news.google.com/rss/search?q=…`) return local
  news as they stand. Adding `-site:nfhsnetwork.com -site:maxpreps.com
  -site:legacy.com` to them on 2026-09-26 turned 35 of 40 results into job
  ads, real-estate listings and social posts. To drop an unwanted source,
  add its publisher name to `excludeSources` in `feeds.config.json`, which
  the fetcher matches against each item's publisher. `wire-core` fails if a
  search gains a `-site:`.

## The root `.gitignore`'s `.env.*` also swallows `.env.example`

`.gitignore` has both `.env` and `.env.*` to keep real secrets out of every
subproject. The broad pattern has a side effect: it also matches
`.env.example`, the placeholder file meant to be committed so a new
subproject documents which environment variables it needs. Without an
exception, that file silently never gets tracked — `git status` won't even
flag it as a problem, since untracked-and-ignored looks the same as
untracked-and-fine at a glance.

This was caught while scaffolding `claude-architect-lab/`, which needed its
own `.env.example`. The fix already in place: `.gitignore` has
`!.env.example` right after the `.env.*` line, so any subproject's example
file stays trackable while `.env` and every other `.env.*` variant stay
ignored. If a future subproject needs a differently-named placeholder (e.g.
`.env.sample`), it needs its own `!` exception line, or it will vanish the
same way.

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
