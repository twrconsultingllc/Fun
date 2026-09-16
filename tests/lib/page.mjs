/* Loading a page under test, from disk or from the deployed URL. */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadPage(target) {
    if (/^https?:\/\//.test(target)) {
        const response = await fetch(target);
        if (!response.ok) throw new Error(`${target} returned HTTP ${response.status}`);
        return { html: await response.text(), url: target, source: target };
    }
    const path = resolve(target);
    return { html: await readFile(path, 'utf8'), url: pathToFileURL(path).href, source: path };
}

export async function requireJsdom() {
    try {
        return await import('jsdom');
    } catch {
        throw new Error(
            'jsdom is not installed. Run:  cd tests && npm install\n' +
            '(The pure-math tests run without it; the DOM tests need it.)'
        );
    }
}

/* Every window opened here, so nothing can outlive the run. `pretendToBeVisual`
   gives jsdom a real ~16ms requestAnimationFrame timer, and a page with a
   self-scheduling rAF loop — race-day.html and ai-swarm.html both have one —
   keeps that timer alive forever. Node then never drains its event loop and the
   process hangs with the test results stuck in a pipe. `run.mjs` calls
   process.exit(), which papers over it there, but any ad-hoc script that
   imports this module hangs outright. Closing the window stops the timers. */
const openWindows = new Set();

// The Tailwind, Font Awesome and three.js CDNs are never fetched under jsdom.
const CDN_NOISE = /tailwind is not defined|Could not load|Not implemented|Failed to fetch/i;

/* jsdom parses asynchronously and the page renders on DOMContentLoaded,
   so every DOM test has to wait for load before asserting anything. */
export async function openDom(html, url, { collectErrors = true, ignore = null, beforeParse = null } = {}) {
    const { JSDOM, VirtualConsole } = await requireJsdom();
    const errors = [];
    const virtualConsole = new VirtualConsole();

    if (collectErrors) {
        virtualConsole.on('jsdomError', (e) => {
            if (CDN_NOISE.test(e.message)) return;
            if (ignore && ignore.test(e.message)) return;
            errors.push(e.message);
        });
    }

    const options = { runScripts: 'dangerously', url, virtualConsole, pretendToBeVisual: true };
    if (beforeParse) options.beforeParse = beforeParse;

    const dom = new JSDOM(html, options);
    openWindows.add(dom.window);

    if (dom.window.document.readyState !== 'complete') {
        await new Promise((r) => dom.window.addEventListener('load', r));
    }

    const close = () => closeWindow(dom.window);
    return { dom, window: dom.window, document: dom.window.document, errors, close };
}

function closeWindow(window) {
    openWindows.delete(window);
    // A window torn down mid-callback can throw on close; the timers still stop.
    try { window.close(); } catch { /* already gone */ }
}

/* Called by the runner between suites, so one suite that forgets to close its
   window cannot leave a timer running for the rest of the run. */
export function closeAllDoms() {
    const count = openWindows.size;
    for (const window of [...openWindows]) closeWindow(window);
    return count;
}

/* Helpers that mirror how a person actually drives the page. */
export function domHelpers(window) {
    const document = window.document;
    const $ = (id) => document.getElementById(id);
    return {
        $,
        text: (id) => ($(id) ? $(id).textContent.trim() : `<missing #${id}>`),
        fire: (id, type) => $(id).dispatchEvent(new window.Event(type, { bubbles: true })),
        type: (id, value) => { $(id).value = String(value); $(id).dispatchEvent(new window.Event('input', { bubbles: true })); },
        pick: (id, value) => { $(id).value = String(value); $(id).dispatchEvent(new window.Event('change', { bubbles: true })); },
        blur: (id) => $(id).dispatchEvent(new window.Event('change', { bubbles: true })),
        secondsOf: (hhmmss) => { const p = String(hhmmss).split(':').map(Number); return p[0] * 3600 + p[1] * 60 + p[2]; }
    };
}
