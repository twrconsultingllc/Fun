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

555 assertions across six suites.

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

## Note on expected values

Every hard-coded expectation was derived independently of the page's own code
(1 mi = 1609.344 m and 1 yd = 0.9144 m are exact by the 1959 international
agreement). If a test fails, do not "fix" it by pasting in whatever the page
now prints — re-derive the number first.
