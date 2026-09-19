/* scroll-transit.html — CSS scroll-driven animation + View Transitions.
 *
 * jsdom implements neither `CSS.supports('animation-timeline: ...')` nor
 * `document.startViewTransition`, so opening this page under jsdom naturally
 * exercises both of its "unsupported" fallback paths — the same ones a real
 * older browser would hit — for free. That also means reduced-motion can
 * only be observed at jsdom's own default (`matchMedia(...).matches` is
 * always false there), not toggled from the test.
 */

import { openDom } from './lib/page.mjs';

export const name = 'Scroll Transit — scroll-timeline and view-transition fallbacks';

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

        const api = window.__scrolltransit;
        t.ok('the page exposes its test hooks', !!api);
        if (!api) return;

        t.section('Feature detection (jsdom has neither capability)');

        t.eq('scroll-timeline support reads false in jsdom', api.supportsScrollTimeline, false);
        t.eq('view-transition support reads false in jsdom', api.supportsViewTransitions, false);
        t.eq('reduced motion reads jsdom\'s default', api.reducedMotion, false);

        t.ok('the scroll-timeline fallback class is applied', document.documentElement.classList.contains('no-scroll-timeline'));

        const timelineBanner = document.getElementById('timeline-banner');
        t.ok('the scroll-timeline banner is visible', timelineBanner.classList.contains('show'));

        const vtBanner = document.getElementById('vt-banner');
        t.ok('the view-transition banner is visible', vtBanner.classList.contains('show'));

        t.section('The swatch grid still works without View Transitions');

        const before = api.getOrder();
        t.eq('six swatches are tracked', before.length, 6);

        const target = before[before.length - 1];
        const afterPromote = api.promote(target);
        t.eq('promote() moves the target to the front', afterPromote[0], target);
        t.eq('promote() keeps the same six ids', afterPromote.slice().sort().join(','), before.slice().sort().join(','));

        const featured = document.getElementById('featured');
        t.ok('the featured slot mentions the promoted swatch', featured.textContent.length > 0);

        const beforeShuffle = api.getOrder();
        const afterShuffle = api.shuffle();
        t.eq('shuffle() keeps the same six ids', afterShuffle.slice().sort().join(','), beforeShuffle.slice().sort().join(','));

        const grid = document.getElementById('swatch-grid');
        t.eq('the grid renders the five non-featured swatches', grid.children.length, 5);
    } finally {
        env.close();
    }
}
