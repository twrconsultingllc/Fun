/* index.html — the landing page. Its script loads three.js from a CDN for the
 * scrolling 3D background, which jsdom can't fetch, so this parses the markup
 * without running scripts and checks what an edit to the page can break: every
 * gallery link goes somewhere real (a file in the repo when run against the
 * working copy), each link has its own section, and each section is in the CSS
 * rule that centres the links. */

import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { requireJsdom } from './lib/page.mjs';

export const name = 'Landing page (index.html)';

export default async function run(t, page) {
    const { JSDOM } = await requireJsdom();
    const dom = new JSDOM(page.html, { url: page.url });
    const { document } = dom.window;

    try {
        t.section('Gallery links');

        const links = Array.from(document.querySelectorAll('main section > a.space-invaders-link'))
            .filter((a) => a.id !== 'secret-link');
        t.ok('the gallery has links', links.length > 0);
        t.ok('links to Sentinel Web', links.some((a) => a.getAttribute('href') === 'sentinel-web.html'));

        const local = links.map((a) => a.getAttribute('href')).filter((h) => !/^[a-z]+:/i.test(h));
        if (page.url.startsWith('file:')) {
            const missing = [];
            for (const href of local) {
                try { await access(fileURLToPath(new URL(href, page.url))); } catch { missing.push(href); }
            }
            t.eq('every local gallery link points to a file in the repo', missing.join(', '), '');
        } else {
            t.note('file checks skipped: not running against the working copy');
        }

        const external = links.map((a) => a.getAttribute('href')).filter((h) => /^[a-z]+:/i.test(h));
        t.ok('external links use https', external.every((h) => h.startsWith('https://')));

        t.section('Sections');

        const ids = Array.from(document.querySelectorAll('main section[id]')).map((s) => s.id);
        t.eq('section ids are unique', new Set(ids).size, ids.length);
        const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('\n');
        const centred = ids.filter((id) => /^section-\d+$/.test(id) && Number(id.slice(8)) >= 4);
        const unstyled = centred.filter((id) => !new RegExp(`#${id}\\b[^{]*\\{[^}]*justify-content: center`).test(css));
        t.eq('every gallery section from section-4 on is in the centring rule', unstyled.join(', '), '');
    } finally {
        dom.window.close();
    }
}
