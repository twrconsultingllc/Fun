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

/* jsdom parses asynchronously and the page renders on DOMContentLoaded,
   so every DOM test has to wait for load before asserting anything. */
export async function openDom(html, url, { collectErrors = true } = {}) {
    const { JSDOM, VirtualConsole } = await requireJsdom();
    const errors = [];
    const virtualConsole = new VirtualConsole();

    if (collectErrors) {
        virtualConsole.on('jsdomError', (e) => {
            // The Tailwind and Font Awesome CDNs are never fetched under jsdom.
            if (/tailwind is not defined|Could not load|Not implemented|Failed to fetch/i.test(e.message)) return;
            errors.push(e.message);
        });
    }

    const dom = new JSDOM(html, { runScripts: 'dangerously', url, virtualConsole, pretendToBeVisual: true });
    if (dom.window.document.readyState !== 'complete') {
        await new Promise((r) => dom.window.addEventListener('load', r));
    }
    return { dom, window: dom.window, document: dom.window.document, errors };
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
