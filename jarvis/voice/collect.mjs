/* J.A.R.V.I.S.: every fixed line he says, word for word, for recording (Session 18 of jarvis/build-plan.html).
 *
 * The lines come from the page itself: jarvis-test.html is opened in jsdom and asked for voiceLines(skin), which
 * builds them from the same lists the page speaks from (each skin's lines, the greetings, jokes, fun facts and so on),
 * one sentence each, as the page looks them up. Anything with a digit, a date word or something personal() flags is
 * left out there, and a line with a name is never collected (the greeting is collected without one).
 *
 *   node jarvis/voice/collect.mjs            prints {"jarvis": [...], "matrix": [...], "panther": [...]} as JSON
 *
 * Needs jsdom, from tests/ (cd tests && npm ci). tests/jarvis-voice.test.mjs runs collect() and checks every line. */

import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SKINS = ['jarvis', 'matrix', 'panther'];
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export async function collect(page = 'jarvis-test.html') {
    const { openDom, closeAllDoms } = await import(pathToFileURL(ROOT + 'tests/lib/page.mjs').href);
    const html = await readFile(ROOT + page, 'utf8');
    // No network, no IndexedDB, no canvas: only the page's own lists are read.
    const env = await openDom(html, 'https://twrconsultingllc.github.io/Fun/' + page, {
        ignore: /getContext|HTMLCanvasElement|indexedDB|Failed to fetch/,
        beforeParse(w) { w.fetch = async () => { throw new w.TypeError('Failed to fetch'); }; }
    });
    try {
        const J = env.window.__jarvis;
        const out = {};
        for (const k of SKINS) out[k] = [...J.voiceLines(k)];
        return out;
    } finally {
        env.close(); closeAllDoms();
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const lines = await collect();
    process.stdout.write(JSON.stringify(lines, null, 1) + '\n');
    process.exit(0);
}
