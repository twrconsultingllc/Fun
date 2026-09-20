/* study/mockup-hybrid-home.html — Variation C (hybrid) of the Claude
 * Architect Lab product-UI mockups. A plain interactive page, runs end to
 * end under jsdom. This variation's whole point is the cross-panel
 * highlight — running the pipeline in the docked chat panel should light up
 * the matching engagement tiles in the case-file panel — so that behavior
 * is what this suite actually checks, not just that the trace renders. */

import { openDom } from './lib/page.mjs';

export const name = 'Mockup — Variation C (hybrid cross-panel highlight)';

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

        const api = window.__mockupHybrid;
        t.ok('the page exposes window.__mockupHybrid', !!api);
        if (!api || !api.runPipeline) return;

        t.section('Case-file panel renders before anything is asked');

        t.eq('three engagement tiles render (Texas, Florida, Illinois)', document.querySelectorAll('.engagement-tile').length, 3);
        t.eq('no state is cross-highlighted yet', api.highlightedStates().length, 0);
        t.eq('no reviewed badges yet', document.querySelectorAll('.reviewed-badge').length, 0);

        t.section('runPipeline() — deterministic, no timers');

        api.runPipeline();

        t.ok('isComplete() reports true', api.isComplete());
        t.eq('all five step cards rendered in the chat panel', document.querySelectorAll('.pipeline-step').length, 5);
        t.eq('all five step cards are visible', document.querySelectorAll('.pipeline-step.visible').length, 5);

        t.section('The differentiator: the case-file panel gets cross-highlighted');

        const highlighted = api.highlightedStates().slice().sort();
        t.eq('Texas, Florida, and Illinois all get cross-highlighted', highlighted.join(', '), 'Florida, Illinois, Texas');
        t.eq('all three engagement tiles carry the cross-highlight class', document.querySelectorAll('.engagement-tile.cross-highlight').length, 3);
        t.eq('all three engagement tiles pick up a reviewed badge', document.querySelectorAll('.reviewed-badge').length, 3);

        t.section('A link to the full packet appears once the run finishes');

        t.ok('a link to mockup-hybrid-result.html is present', !!document.querySelector('a[href="mockup-hybrid-result.html"]'));
    } finally {
        env.close();
    }
}
