#!/usr/bin/env node
/* Test runner for the single-file pages in this repo.
 *
 *   node run.mjs                                  # test ../tricalc.html
 *   node run.mjs --target=../tricalc.html         # test a specific file
 *   node run.mjs --target=https://…/tricalc.html  # test the deployed page
 *   node run.mjs --only=core                      # run one suite
 *
 * Suites are plain ES modules exporting `name` and a default
 * `run(harness, page)` function, so adding one is a single line below.
 */

import { createHarness } from './lib/harness.mjs';
import { loadPage } from './lib/page.mjs';

const SUITES = [
    { id: 'core', file: './tricalc.core.test.mjs' },
    { id: 'dom', file: './tricalc.dom.test.mjs' }
];

const DEFAULT_TARGET = new URL('../tricalc.html', import.meta.url).pathname;

function parseArgs(argv) {
    const args = { target: DEFAULT_TARGET, only: null };
    for (const arg of argv.slice(2)) {
        if (arg.startsWith('--target=')) args.target = arg.slice('--target='.length);
        else if (arg.startsWith('--only=')) args.only = arg.slice('--only='.length);
        else if (arg === '--help' || arg === '-h') args.help = true;
        else if (!arg.startsWith('--')) args.target = arg;
    }
    return args;
}

const args = parseArgs(process.argv);

if (args.help) {
    console.log(`
Usage: node run.mjs [--target=<path|url>] [--only=<${SUITES.map((s) => s.id).join('|')}>]

  --target   Page to test. Defaults to ../tricalc.html.
             Pass a URL to test what is actually deployed.
  --only     Run a single suite.

First run: cd tests && npm install   (installs jsdom)
`);
    process.exit(0);
}

const BOLD = '\x1b[1m', DIM = '\x1b[2m', GREEN = '\x1b[32m', RED = '\x1b[31m', OFF = '\x1b[0m';

let page;
try {
    page = await loadPage(args.target);
} catch (error) {
    console.error(`${RED}Could not load ${args.target}${OFF}\n${error.message}`);
    process.exit(2);
}

console.log(`\n${BOLD}Testing${OFF} ${page.source}  ${DIM}(${(page.html.length / 1024).toFixed(0)} KB)${OFF}`);

const harness = createHarness();
let crashed = 0;

for (const suite of SUITES) {
    if (args.only && args.only !== suite.id) continue;
    const module = await import(suite.file);
    console.log(`\n${BOLD}══ ${module.name || suite.id} ══${OFF}`);
    try {
        await module.default(harness, page);
    } catch (error) {
        crashed++;
        console.log(`  ${RED}CRASH${OFF} ${suite.id}: ${error.message}`);
        if (process.env.VERBOSE) console.log(error.stack);
    }
}

const { pass, fail, failures } = harness.totals;
const bad = fail + crashed;

console.log(`\n${bad ? RED : GREEN}${BOLD}${pass} passed, ${fail} failed${crashed ? `, ${crashed} crashed` : ''}${OFF}`);
if (failures.length) console.log(failures.map((f) => `  ${RED}·${OFF} ${f}`).join('\n'));
console.log('');

process.exit(bad ? 1 : 0);
