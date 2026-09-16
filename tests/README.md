# Tests

Regression tests for the single-file pages in this repo. No test framework —
just Node plus `jsdom`, so these keep running years from now.

## Run them

```bash
cd tests
npm install          # once, installs jsdom
npm test             # tests ../tricalc.html
```

To check what is **actually deployed** rather than your working copy:

```bash
npm run test:live
# or any URL / path:
node run.mjs --target=https://twrconsultingllc.github.io/Fun/tricalc.html
node run.mjs --target=../tricalc.html --only=core
```

Exit code is 0 when everything passes, 1 on any failure, 2 if the page could
not be loaded — so this drops straight into CI or a pre-push hook.

## What is covered

`tricalc.html` — 112 assertions in two suites:

| Suite | File | Covers |
|---|---|---|
| `core` | `tricalc.core.test.mjs` | Unit conversion, pace/speed math, clock arithmetic, plan invariants, bad-input guards. Runs the page's math directly, with no DOM. |
| `dom` | `tricalc.dom.test.mjs` | The real page in jsdom: rendering, typing into fields, unit toggles, presets, warnings, share links, persistence, and markup/script sync. |

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
