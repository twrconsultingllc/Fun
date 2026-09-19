/* widget-kit.html — custom elements + Shadow DOM.
 *
 * Unlike the WebGL/Web Audio pattern-lab pages, jsdom supports custom
 * elements and Shadow DOM natively, so this suite drives the real
 * components end to end rather than exercising a fallback path.
 */

import { openDom } from './lib/page.mjs';

export const name = 'Widget Kit — custom elements and Shadow DOM';

export default async function run(t, page) {
    let env;
    try {
        env = await openDom(page.html, page.url);
    } catch (error) {
        t.ok('the page opens in jsdom', false);
        t.note(error.message);
        return;
    }

    const { window, document, errors } = env;

    try {
        t.section('Booting');

        t.eq('the page script ran without throwing', errors.length, 0);
        if (errors.length) t.note(errors.join('\n       '));

        const api = window.__widgetkit;
        t.ok('the page exposes its test hooks', !!api);
        if (!api) return;

        for (const tag of api.elements) {
            t.ok(`customElements.get() resolves ${tag}`, !!window.customElements.get(tag));
        }

        t.section('<neon-badge> — attribute reflection, no style leakage');

        const badge = document.querySelector('neon-badge[tone="pink"]');
        t.ok('a pink badge exists on the page', !!badge);
        t.ok('the badge has an open shadow root', !!(badge && badge.shadowRoot));
        if (badge) {
            const pill = badge.shadowRoot.querySelector('.pill');
            t.ok('the shadow root renders a .pill element', !!pill);
            t.eq('the badge label is set via the reflected label attribute', pill.textContent, badge.getAttribute('label'));

            badge.tone = 'green';
            t.eq('setting .tone reflects to the attribute', badge.getAttribute('tone'), 'green');
        }

        const outerPill = document.querySelector('.pill');
        t.eq('the page\'s own light DOM has no .pill element (shadow styles/markup stay encapsulated)', outerPill, null);

        t.section('<rating-stars> — click to rate, readonly blocks it');

        const rateMe = document.getElementById('rate-me');
        t.ok('the interactive rating widget exists', !!rateMe);
        if (rateMe) {
            const stars = rateMe.shadowRoot.querySelectorAll('.star');
            t.eq('five star buttons render for max=5', stars.length, 5);

            let firedValue = null;
            rateMe.addEventListener('rating-change', (e) => { firedValue = e.detail.value; });
            stars[4].click();
            t.eq('clicking the 5th star sets value to 5', rateMe.value, 5);
            t.eq('rating-change fires with the new value', firedValue, 5);

            const output = document.getElementById('rate-output');
            t.eq('the page\'s own listener updates from the event', output.textContent, 'Current value: 5');
        }

        const readonlyStars = document.querySelectorAll('rating-stars[readonly]');
        t.eq('a readonly rating widget exists', readonlyStars.length, 1);
        if (readonlyStars.length) {
            const ro = readonlyStars[0];
            const before = ro.value;
            ro.shadowRoot.querySelectorAll('.star')[0].click();
            t.eq('clicking a readonly widget does not change its value', ro.value, before);
        }

        t.section('<collapse-panel> — header click and programmatic toggle, both fire toggle');

        const panels = document.querySelectorAll('collapse-panel');
        t.eq('two collapse panels are on the page', panels.length, 2);
        if (panels.length === 2) {
            const closedPanel = panels[0];
            t.eq('the first panel starts closed', closedPanel.open, false);

            let toggleDetail = null;
            closedPanel.addEventListener('toggle', (e) => { toggleDetail = e.detail; });
            closedPanel.shadowRoot.querySelector('.header').click();
            t.eq('clicking the header opens it', closedPanel.open, true);
            t.eq('toggle fires with open: true', toggleDetail && toggleDetail.open, true);

            const openPanel = panels[1];
            t.eq('the second panel starts open (via the open attribute)', openPanel.open, true);
            let secondDetail = null;
            openPanel.addEventListener('toggle', (e) => { secondDetail = e.detail; });
            openPanel.open = false;
            t.eq('setting .open = false reflects to the attribute', openPanel.hasAttribute('open'), false);
            t.eq('toggle fires from the programmatic change too', secondDetail && secondDetail.open, false);
        }

        t.section('<copy-chip> — clipboard unsupported in jsdom');

        const chip = document.querySelector('copy-chip');
        t.ok('a copy-chip exists', !!chip);
        if (chip) {
            let copyDetail = null;
            chip.addEventListener('chip-copy', (e) => { copyDetail = e.detail; });
            chip.shadowRoot.querySelector('button').click();
            t.eq('chip-copy fires with ok: false when clipboard is unavailable', copyDetail && copyDetail.ok, false);
            t.eq('the status text shows synchronously, no timer involved', chip.shadowRoot.querySelector('.status').textContent, 'Copy unsupported');
        }
    } finally {
        env.close();
    }
}
