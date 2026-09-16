#!/usr/bin/env node
/* Test runner for the single-file pages in this repo.
 *
 *   node run.mjs                                   # every suite, working copy
 *   node run.mjs --only=swarm-core                 # one suite
 *   node run.mjs --page=ai-swarm.html              # every suite for one page
 *   node run.mjs --base=https://…/Fun/             # run everything against the deploy
 *   node run.mjs --target=../tricalc.html --only=core
 *
 * Suites are plain ES modules exporting `name` and a default
 * `run(harness, page)` function, so adding one is a single line below.
 * Each suite names the page it drives; `--base` decides where that page is
 * read from, which is how the same assertions run against the working copy
 * and against what GitHub Pages actually serves.
 */

import { createHarness } from './lib/harness.mjs';
import { loadPage, closeAllDoms } from './lib/page.mjs';

const SUITES = [
    { id: 'core', page: 'tricalc.html', file: './tricalc.core.test.mjs' },
    { id: 'dom', page: 'tricalc.html', file: './tricalc.dom.test.mjs' },
    { id: 'swarm-core', page: 'ai-swarm.html', file: './ai-swarm.core.test.mjs' },
    { id: 'swarm-dom', page: 'ai-swarm.html', file: './ai-swarm.dom.test.mjs' },
    { id: 'raceday-core', page: 'race-day.html', file: './race-day.core.test.mjs' },
    { id: 'raceday-dom', page: 'race-day.html', file: './race-day.dom.test.mjs' },
    { id: 'bots-core', page: 'battle-bots-V2/public/index.html', file: './battle-bots-v2.core.test.mjs' },
    { id: 'bots-dom', page: 'battle-bots-V2/public/index.html', file: './battle-bots-v2.dom.test.mjs' },
    { id: 'fullcircle-core', page: 'fullcircle.html', file: './fullcircle.core.test.mjs' }
];

const DEFAULT_BASE = new URL('../', import.meta.url).pathname;

function parseArgs(argv) {
    const args = { base: DEFAULT_BASE, target: null, only: null, page: null };
    for (const arg of argv.slice(2)) {
        if (arg.startsWith('--base=')) args.base = arg.slice('--base='.length);
        else if (arg.startsWith('--target=')) args.target = arg.slice('--target='.length);
        else if (arg.startsWith('--only=')) args.only = arg.slice('--only='.length);
        else if (arg.startsWith('--page=')) args.page = arg.slice('--page='.length);
        else if (arg === '--help' || arg === '-h') args.help = true;
        else if (!arg.startsWith('--')) args.target = arg;
    }
    return args;
}

/* A base is either a URL or a directory; either way the page hangs off it. */
function resolveTarget(base, page) {
    if (/^https?:\/\//.test(base)) return new URL(page, base.endsWith('/') ? base : base + '/').href;
    return (base.endsWith('/') ? base : base + '/') + page;
}

const args = parseArgs(process.argv);

if (args.help) {
    console.log(`
Usage: node run.mjs [--base=<dir|url>] [--only=<suite>] [--page=<file>] [--target=<path|url>]

  --base     Where to read pages from. Defaults to the repo root.
             Pass a URL to test what is actually deployed.
  --only     Run a single suite: ${SUITES.map((s) => s.id).join(', ')}
  --page     Run every suite that covers one page, e.g. ai-swarm.html
  --target   Force an exact page for the selected suites. Best with --only.

First run: cd tests && npm install   (installs jsdom)
`);
    process.exit(0);
}

const BOLD = '\x1b[1m', DIM = '\x1b[2m', GREEN = '\x1b[32m', RED = '\x1b[31m', OFF = '\x1b[0m';

const selected = SUITES.filter((s) => (!args.only || args.only === s.id) && (!args.page || args.page === s.page));

if (!selected.length) {
    console.error(`${RED}No suite matches${OFF} ${args.only || args.page}`);
    process.exit(2);
}

/* Load each distinct page once, however many suites drive it. */
const pages = new Map();
async function pageFor(suite) {
    const target = args.target || resolveTarget(args.base, suite.page);
    if (!pages.has(target)) pages.set(target, await loadPage(target));
    return pages.get(target);
}

const harness = createHarness();
let crashed = 0;

for (const suite of selected) {
    let page;
    try {
        page = await pageFor(suite);
    } catch (error) {
        crashed++;
        console.log(`\n${RED}Could not load the page for ${suite.id}${OFF}\n  ${error.message}`);
        continue;
    }

    const module = await import(suite.file);
    console.log(`\n${BOLD}══ ${module.name || suite.id} ══${OFF}  ${DIM}${page.source} (${(page.html.length / 1024).toFixed(0)} KB)${OFF}`);
    try {
        await module.default(harness, page);
    } catch (error) {
        crashed++;
        console.log(`  ${RED}CRASH${OFF} ${suite.id}: ${error.message}`);
        if (process.env.VERBOSE) console.log(error.stack);
    } finally {
        /* Close any window the suite left open. A page with a requestAnimationFrame
           loop holds jsdom's frame timer, and therefore Node's event loop, open
           for good; without this the run only ends because of the process.exit
           below, and every later suite competes with a dead page's timers. */
        const leaked = closeAllDoms();
        if (leaked && process.env.VERBOSE) console.log(`  ${DIM}closed ${leaked} window(s)${OFF}`);
    }
}

const { pass, fail, failures } = harness.totals;
const bad = fail + crashed;

console.log(`\n${bad ? RED : GREEN}${BOLD}${pass} passed, ${fail} failed${crashed ? `, ${crashed} crashed` : ''}${OFF}`);
if (failures.length) console.log(failures.map((f) => `  ${RED}·${OFF} ${f}`).join('\n'));
console.log('');

process.exit(bad ? 1 : 0);
