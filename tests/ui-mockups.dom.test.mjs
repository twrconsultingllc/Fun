/* study/ui-mockups.html — the landing page tying the three product-UI mockup
 * variations together. A static page (zero scripts by design), so this just
 * pins that it links to all three variations' home pages and to its two
 * sibling study pages, and that it opens clean. */

import { openDom } from './lib/page.mjs';

export const name = 'Mockup — variations index (ui-mockups.html)';

export default async function run(t, page) {
    let env;
    try {
        env = await openDom(page.html, page.url);
    } catch (error) {
        t.ok('the page opens in jsdom', false);
        t.note(error.message);
        return;
    }

    const { document, errors } = env;

    try {
        t.section('Booting');

        t.eq('the page has no console errors', errors.length, 0);
        if (errors.length) t.note(errors.join('\n       '));

        t.section('Links to all three variations');

        t.ok('links to the chat variation', !!document.querySelector('a[href="mockup-chat-home.html"]'));
        t.ok('links to the dashboard variation', !!document.querySelector('a[href="mockup-dash-home.html"]'));
        t.ok('links to the hybrid variation', !!document.querySelector('a[href="mockup-hybrid-home.html"]'));

        t.section('Links to sibling study pages');

        t.ok('links back to the study index', !!document.querySelector('a[href="index.html"]'));
        t.ok('links to ui-plan.html and distinguishes itself from it', !!document.querySelector('a[href="ui-plan.html"]'));
        t.ok('links to usecase.html, the concept this explores', !!document.querySelector('a[href="usecase.html"]'));

        t.section('Comparison table');

        const rows = document.querySelectorAll('table tbody tr');
        t.eq('the comparison table has one row per variation', rows.length, 3);
    } finally {
        env.close();
    }
}
