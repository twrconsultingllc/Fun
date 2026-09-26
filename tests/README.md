# Tests

Regression tests for the single-file pages in this repo. No test framework —
just Node plus `jsdom`, so these keep running years from now.

## Run them

```bash
cd tests
npm install          # once, installs jsdom
npm test             # every suite, against the working copy
```

To check what is **actually deployed** rather than your working copy:

```bash
npm run test:live    # every suite, against GitHub Pages
```

To narrow things down:

```bash
node run.mjs --only=swarm-core                    # one suite
node run.mjs --page=ai-swarm.html                 # every suite for one page
node run.mjs --base=https://twrconsultingllc.github.io/Fun/ --page=ai-swarm.html
node run.mjs --target=../tricalc.html --only=core  # force an exact file
```

Each suite names the page it drives, and `--base` decides where that page is
read from. That is what lets the identical assertions run against the working
copy and against the deploy.

Exit code is 0 when everything passes, 1 on any failure, 2 if the page could
not be loaded — so this drops straight into CI or a pre-push hook.

## What is covered

1095 assertions across twenty-three suites.

### `academy/` (Full Circle Academy mockup)

| Suite | File | Covers |
|---|---|---|
| `academy` | `academy.dom.test.mjs` | The landing, course and lesson pages in jsdom: the strict CSP (`script-src 'self'`, frames only from `youtube-nocookie.com`, no inline scripts/handlers/style attributes), one card/row/section per entry in `courses.js`, query-string routing including an unknown course and an out-of-range lesson, YouTube link parsing (every common link shape accepted, look-alike hosts and junk rejected), videos preset in `courses.js` (well-formed, unique, embedded without a paste) and the featured landing video, the paste-to-embed video slot, a tampered `localStorage` value being ignored, and mark-complete. |

These pages load two shared same-origin scripts rather than inline ones, and
jsdom only fetches external scripts with `resources: 'usable'` (which would
also try Google Fonts). The suite reads `courses.js` and `academy.js` itself,
from wherever `--base` points, and inlines them in place of the
`<script src>` tags, so `npm run test:live` still exercises the deployed files.

### `haunted-house.html`

| Suite | File | Covers |
|---|---|---|
| `haunted-house` | `haunted-house.dom.test.mjs` | The 1-5 scare-level picker and the level 5 age gate (Cancel/Escape leave the old level selected, and `start(5)` can't skip the gate), the house map (every exit two-way, every room reachable), content integrity (a description per level for every room, four text tiers for every hotspot, and none of a list of horror words anywhere in levels 1-2), a full level 1 playthrough by clicking the real exit and hotspot buttons, the level 3 flashlight/BOO/limited hints, the level 4-5 hunter (danger rising over time, the hide window, being caught), level 5 taking a found item back, and the no-Web-Audio path. |

The page draws with inline SVG and DOM buttons, so jsdom runs it with no
stubs. Time-based behaviour (the hunter, scare auto-dismiss) is driven
through `window.__haunted.tick()` / `caught()` / `dismissScare()` rather
than real timers. Randomness (where items hide, random surprises) is pinned
by swapping `Math.random` around the assertions that need it.

### `trick-or-treat-dash.html`

| Suite | File | Covers |
|---|---|---|
| `dash` | `trick-or-treat-dash.dom.test.mjs` | Jump physics against the closed-form answers (peak v²/2g, air time 2v/g, the same height at 30 and 144 fps, double but no triple jump). **Fairness**: every obstacle can be cleared at the slowest and fastest speed it spawns at, found by searching jump timings with the page's own `step()`; every timing window is at least 350 ms on Easy and 250 ms on Normal; and in a 2-minute seeded run, every gap leaves a full jump plus the mode's reaction time. Also candy values, the magnet and shield, hearts and invulnerability, game over and the Easy finish line, costume unlocks, keyboard, pause and tab-switch pause, the real rAF loop, and saved progress being validated on load (tampered, corrupt and wrong-type saves). |

jsdom has no canvas, so the suite stubs `getContext` with a Proxy whose
every method returns the Proxy itself. That lets
`createLinearGradient(...).addColorStop(...)` chains run. The page is loaded
at an `https://` URL so jsdom provides `localStorage`, the same as the
academy suite. `window.__dash.setManual(true)` turns the real-time loop off
so the suite can step the game at a fixed 1/120 s, and `seed(n)` makes a
run repeatable.

### `fullcircle.html`

| Suite | File | Covers |
|---|---|---|
| `fullcircle-core` | `fullcircle.core.test.mjs` | Structural regressions in the medallion artwork: the ring words (SWIM/BIKE/RUN/…) staying on the gear's solid backing plate instead of drifting onto the teeth, the ring text keeping its metal-sweep gradient and animated specular sweep, the water droplets staying at their expanded count and always rendering as liquid mercury regardless of the selected finish, and the static `<svg>` mark staying in sync with the 3D `LOGO_SVG` source for both the droplets and the swimmer/cyclist/runner pictograms. |

Like `battle-bots-V2`, this page has no `window.__pagename` hook and its
`paintIdleArena`-style WebGL setup can't run under jsdom (no `chromium-cli`,
no local `canvas` package — see that section below). Rather than fight that,
this suite works directly on the page's HTML/JS text: it doesn't check that
the artwork looks right (that was judged by rendering it), only that the
specific things a later edit could silently regress — text riding onto the
gear teeth again, droplets shrinking back down, the two SVG copies drifting
apart — stay pinned.

### `tricalc.html`

| Suite | File | Covers |
|---|---|---|
| `core` | `tricalc.core.test.mjs` | Unit conversion, pace/speed math, clock arithmetic, plan invariants, bad-input guards. Runs the page's math directly, with no DOM. |
| `dom` | `tricalc.dom.test.mjs` | The real page in jsdom: rendering, typing into fields, unit toggles, presets, warnings, share links, persistence, and markup/script sync. |

### `ai-swarm.html`

| Suite | File | Covers |
|---|---|---|
| `swarm-core` | `ai-swarm.core.test.mjs` | The layout contract (strongest at the core, weakest at the rim), direction vectors, token/price/date formatting, and the integrity of the ~105-model catalogue: unique ids, resolvable and acyclic lineage, no model descended from a later release, no half-priced entries. Also pins the Anthropic figures against the published model catalogue. |
| `swarm-dom` | `ai-swarm.dom.test.mjs` | The page in jsdom against a small three.js stub, so the whole interaction layer really runs: legend and status filters, search, the timeline scrubber, the detail panel, lineage links, deep links. Then the navigation layer — stepped zoom and its limits, the range slider, camera presets, fly-to-lab, the top-down map, WASD flight and its bounds, and the nearby-models list. Plus the no-WebGL path. |

The page exposes `window.__swarm` (camera state, filter state, nodes, and the
camera helpers) purely so the suite can drive navigation the way a person does
and then check where the camera actually ended up. Nothing on the page reads it.

The nearby-list throttle bug — comparing a seconds-based clock against a
millisecond threshold, so the list refreshed about once every four minutes —
was caught by *"it appears once you are inside the cloud"*. That assertion is
worth keeping for exactly that reason.

#### Why the swarm suite stubs three.js

jsdom has no WebGL and does not fetch the three.js CDN, so `ai-swarm.dom.test.mjs`
supplies a ~90-line stand-in that implements only what the page calls and draws
nothing. That is deliberate: the point is to exercise the page's own logic, not
three's. The suite also runs the page once *without* the stub, to pin what
happens when the CDN is unreachable — the page has to say so on screen, which is
the rule the "make failures visible" work set for this repo.

#### On the `power` score

Each model carries a 0-100 `power` score that drives its distance from the
centre. It is an editorial judgement, not a benchmark, and it is the one field
in the catalogue that cannot be verified against a source. The tests check that
it is in range and internally consistent with the layout — they do not and
cannot check that it is *right*.

### The pattern-lab pages (`scroll-transit.html`, `shader-lab.html`, `widget-kit.html`, `signal-scope.html`)

| Suite | File | Covers |
|---|---|---|
| `scroll-transit` | `scroll-transit.dom.test.mjs` | The scroll-timeline/View-Transitions fallback path (jsdom implements neither `CSS.supports('animation-timeline: …')` nor `document.startViewTransition`), plus the swatch grid's `promote()`/`shuffle()` DOM reordering, which runs the same either way. |
| `shader-lab-core` | `shader-lab.core.test.mjs` | The literal GLSL source of all four shader presets, pinned between `SHADER PRESETS START/END` marker comments — one `shade()` entry point each, balanced braces/parens — without ever needing a real GL context. |
| `shader-lab-dom` | `shader-lab.dom.test.mjs` | The no-WebGL2 fallback (jsdom's `getContext('webgl2')` returns null) and the preset/speed/hue state machine around it — clamping, wrapping, and the active-button UI sync. |
| `widget-kit` | `widget-kit.dom.test.mjs` | The four custom elements for real: Shadow DOM encapsulation (`<neon-badge>`), click-to-rate and the `readonly` guard with a dispatched `rating-change` (`<rating-stars>`), header-click and programmatic toggling both firing `toggle` (`<collapse-panel>`), and the clipboard-unavailable fallback firing `chip-copy` with `ok: false` (`<copy-chip>`). jsdom supports custom elements and Shadow DOM natively, so this is the one pattern-lab page tested end to end rather than via a fallback path. |
| `signal-scope` | `signal-scope.dom.test.mjs` | The no-Web-Audio fallback (`AudioContext`/`webkitAudioContext` are undefined in jsdom) and the sequencer's state machine — waveform/tempo/cutoff clamping, viz-mode switching, and the microphone toggle falling back cleanly when `getUserMedia` is unavailable. |

These four pages exist to demonstrate patterns unused elsewhere in the repo
(CSS scroll-driven animation + View Transitions, raw WebGL2/GLSL shaders,
Web Components/Shadow DOM, and the Web Audio API) — see each page's own
`window.__<name>` hook (`__scrolltransit`, `__shaderlab`, `__widgetkit`,
`__signalscope`) for what a test can drive directly, same reasoning as
`window.__swarm`/`window.__raceday`/`window.__snake` above.

`setCutoff(0)`/`setTempo(0)`/`setSpeed(0)` are asserted explicitly on top of
the more obvious out-of-range clamps: `Number(x) || fallback` silently
replaces a legitimate `0` with the fallback because `0` is falsy in
JavaScript. That exact bug shipped in the first draft of `signal-scope.html`
and `shader-lab.html` and was caught immediately by these assertions — fixed
with `Number.isFinite(x) ? x : fallback` instead.

### `snake.html`

| Suite | File | Covers |
|---|---|---|
| `snake-dom` | `snake.dom.test.mjs` | The rival AI snakes: they populate the board without overlapping anything, running into one kills the player, running into the player kills the rival instead (leaving the player untouched), and a head-on meeting kills both. Also that the new `triangle` and `shard` food kinds exist and `rollFoodType()` can actually produce them from level 2 on. |

The page exposes `window.__snake` (state, the live `snake`/`enemies`/`foods`/
`obstacles` arrays, and `step`/`stepEnemies`/`buildLevel`) purely so the suite
can drive the simulation directly. Nothing on the page reads it.

The rival AI picks a direction fresh every tick — greedy toward the nearest
food, steering away from anything lethal — so making it walk into a specific
cell on cue means cornering it for real: obstacles block every direction but
the one under test, food is cleared so there's nothing to chase instead, and
`Math.random` is pinned so the AI's fallback pick lands on a known index. That
exercises the same code path a player relies on in-game ("cut one off and it
dies instead"), rather than special-casing anything for the test.

Writing that scenario caught a real bug: the head-on mutual-death check was
gated on the enemy not already being marked dead, but the generic "ran into
the player" check always marks it dead first (since a head-on cell is also
just the player's head), so the player's own death branch never ran. Fixed by
checking the position match unconditionally instead of gating on `dead[i]`.

### `race-day.html`

| Suite | File | Covers |
|---|---|---|
| `raceday-core` | `race-day.core.test.mjs` | The race economy — five leg times, the bonus and penalty per leg, and eight rivals whose weighted legs have to add back up to their finishing time — plus the 35-question checklist (four distinct options, one right, an explanation on each, no duplicates), the seeded draw, and the two-link inverse kinematics behind the pedal stroke. |
| `raceday-dom` | `race-day.dom.test.mjs` | The page in jsdom with no WebGL at all: the banner that says so, the progress rail, starting a race, answering by click and by number key, the explanation panel, the running clock and score, crossing into the next leg, a won race and a lost one, the results card and the checklist recap, and the camera control. |

Two numbers hold that suite together and both are derived by hand rather than
read off the page. A perfect race is **8540s (2:22:20)** — the five leg bases
sum to 10080 and twenty right answers take 1540 off. The fastest rival finishes
in **9100s**, which puts the cliff between three mistakes and four. If either
moves, the balance of the game moved with it.

The suite also found two things worth recording. The saddle was three
centimetres too high: sweeping a whole crank revolution through the IK showed
the hip sitting 0.9124 from the pedal against a leg that reaches 0.9099, so the
solver clamped and the foot lifted off at the bottom of the stroke. And a
perfect swim does **not** lead out of the water — Bib 7 is the swim specialist
and is up the road by about ninety seconds, which is the assertion
*"but the swim specialist is still up the road"*.

The page exposes `window.__raceday` for the same reason `ai-swarm.html` exposes
`window.__swarm`: so the suite can press start, step past the pause between
questions instead of sleeping through it, and play a whole race in one call.
Nothing on the page reads it.

The DOM suite drives the page the way a person does — setting input values and
dispatching real events — so it tests behavior rather than internals.

### The regression these exist to prevent

Before TriCalc 4.0 the engine assumed a leg's distance was always expressed in
the same unit as its pace, and never converted. The same Ironman plan read
**10:48:48 in imperial and 12:57:35 in metric**, because an 8:30/mile run pace
was silently reapplied as 8:30/km and kilometre bike distances were divided by
mph. Several tests exist purely to pin that down, notably *"Segment math across
mismatched units"* and *"Every preset agrees across unit systems"*.

## How the core suite reaches the math

`tricalc.html` wraps its DOM-free functions in marker comments:

```js
/* ===== PURE MATH START ===== */
...
/* ===== PURE MATH END ===== */
```

`extractPureMath()` in `lib/harness.mjs` slices that block out and evaluates it
in isolation. **Keep those markers** in any rewrite of the page, and keep the
pure functions inside them free of DOM access, or the `core` suite will report
that the markers are missing and skip.

## Testing a new version of the page

If you rewrite `tricalc.html`, the suites still apply as long as the page keeps
its element ids (`topTotalDisplay`, `swimDist`, `gadgetTableBody`, …) and its
global functions (`applyPreset`, `setUnitSystem`, `computePlan`, …). Two checks
will tell you immediately if it drifted: *"every element id the script looks up
exists"* and *"every inline handler is defined"*.

To test a different page entirely, drop a `<name>.test.mjs` beside these that
exports `name` and a default `run(harness, page)` function, then add one line to
`SUITES` in `run.mjs`. The harness API is `t.section()`, `t.eq()`, `t.near()`,
`t.ok()` and `t.note()`.

### Opening a page in jsdom

Always go through `openDom(html, url, opts)` from `lib/page.mjs` rather than
constructing a `JSDOM` yourself. It waits for `load`, collects real page errors
while filtering the CDN noise jsdom always produces, and — the part that matters
— registers the window so it gets closed.

```js
const { window, document, errors, close } = await openDom(page.html, page.url);
// … assertions …
close();
```

`opts` takes `collectErrors` (default true), `ignore` (an extra `RegExp` of
error messages to treat as noise) and `beforeParse(window)` (jsdom's own hook,
which is how `ai-swarm.dom.test.mjs` injects its three.js stub before the page
script runs).

**Close the window.** `openDom` sets `pretendToBeVisual: true`, which gives
jsdom a real ~16ms `requestAnimationFrame` timer. `race-day.html` and
`ai-swarm.html` both run a self-scheduling rAF loop, so that timer never stops
on its own: Node's event loop never drains and the process hangs forever, with
any buffered output stuck in the pipe. `run.mjs` calls `closeAllDoms()` after
every suite, so a suite that forgets cannot hang the runner — but an ad-hoc
script that imports this module and skips `close()` will hang outright. One did,
for over an hour, which is why this is written down.

### `study/mockup-*.html` and `study/ui-mockups.html` — the product UI mockups

| Suite | File | Covers |
|---|---|---|
| `mockup-chat` | `mockup-chat.dom.test.mjs` | Variation A (chat): the scripted five-assistant trace runs in the documented order, the result bubble carries all three target states and a working copy button, and `sendPrompt()` stays safe to call more than once. |
| `mockup-dash` | `mockup-dash.dom.test.mjs` | Variation B's overview: the three summary tiles are computed live from the page's own sample data (not hardcoded) — pinned against hand-derived totals (3 clients, 5 open engagements, 14 pending checklist items). |
| `mockup-dash-pipeline` | `mockup-dash-pipeline.dom.test.mjs` | Variation B's dedicated trace screen: the five-dot progress row, the step order, and that "View result" only unlocks once the trace actually finishes. |
| `mockup-hybrid` | `mockup-hybrid.dom.test.mjs` | Variation C's actual differentiator: running the pipeline cross-highlights the matching Texas/Florida/Illinois tiles in the case-file panel and adds a reviewed badge to each — not just that the trace itself renders. |
| `ui-mockups-index` | `ui-mockups.dom.test.mjs` | The landing page links to all three variations' home pages and to its sibling study pages, and its comparison table has one row per variation. |

These pages are plain interactive HTML/CSS/JS — no canvas, WebGL, or Web
Audio — so unlike `battle-bots-V2`/`fullcircle.html` below, they run end to
end under jsdom the same way `tricalc.html`/`signal-scope.html` do. Each
page that has a scripted "pipeline run" (all except the static
`ui-mockups.html`) exposes a `window.__mockup<Variant>` hook whose
`runPipeline()` replays the same reveal logic with no `setTimeout` delays,
so the DOM state after a run can be asserted deterministically instead of
waiting on real timers — same reasoning as `window.__swarm`/`__raceday`/
`__snake` above. Every `CLIENTS`/`STATES`/`PIPELINE_STEPS` value asserted
against here is duplicated inline in each page per this repo's single-file
convention, not imported from a shared module.

### `battle-bots-V2` (a multi-file app, not a single-file page)

| Suite | File | Covers |
|---|---|---|
| `bots-core` | `battle-bots-v2.core.test.mjs` | A bot's configured weapon never changes at runtime no matter what skills fire; Aggressive Charge scales off the bot's *own* weapon instead of a fixed generic shot; the bonus shields added to the other skills (20 on Snipe, 30 on Flank Left/Right and Retreat, 70 on Defend, none on Charge); the weapon fire-rate balance numbers. |
| `bots-dom` | `battle-bots-v2.dom.test.mjs` | The control panel: default speed and weapon match the balance change, the weapon dropdown actually drives the team config and survives a panel re-render, and the stats table's WPN column shows the right label. |

battle-bots-V2 is the one app in this repo that isn't a single self-contained
HTML file — it's `public/*.js` ES modules plus a `api/` serverless function,
and its real, functional deployment is a separate Vercel project, not GitHub
Pages. That breaks the pattern the other suites use:

- **No `extractPureMath`.** There's nothing to extract — the logic already
  lives in its own files. `bots-core` just `import()`s the real
  `entities.js`/`skills.js`/`state.js` directly.
- **No `window.__pagename` hook.** `bots-dom` can't hand the whole page to
  `openDom` and read results off a hook the way `ai-swarm.dom`/`race-day.dom`
  do, because battle-bots-V2 exposes no such hook and `main.js` calls
  `paintIdleArena()` at import time — which needs a working `<canvas>` 2D
  context that jsdom doesn't have without the native `canvas` package, and
  throws immediately. So `bots-dom` parses `index.html` with `runScripts:
  'outside-only'` (markup loads, the embedded module script does not run)
  and imports `ui.js` directly against that document instead — a unit test
  of one module, not a full-page integration test.
- **A remote target needs staging.** `entities.js` imports `./skills.js` and
  friends by relative path, which Node's ESM loader only resolves against
  `file:`/`data:` URLs — not `https:`. So testing a deployed copy (`--target=
  https://<url>/index.html`) fetches those files into a temp dir first and
  imports them from there; see `lib/bots-modules.mjs`.
- **`npm run test:live` still works here**, just not the way it sounds: the
  default GitHub Pages base serves this app's static files too (the whole
  repo is published there), so both suites pass against it — they just never
  exercise the real `/api/get-actions` route, which only exists on Vercel.
  Point `--target` at the live Vercel URL to test the actual running app.

## Note on expected values

Every hard-coded expectation was derived independently of the page's own code
(1 mi = 1609.344 m and 1 yd = 0.9144 m are exact by the 1959 international
agreement). If a test fails, do not "fix" it by pasting in whatever the page
now prints — re-derive the number first.
