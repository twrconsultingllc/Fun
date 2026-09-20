/* study/mockup-dash-pipeline.html — the dedicated pipeline-trace screen in
 * Variation B (dashboard). Normally auto-plays the five-assistant trace with
 * ~600ms between steps; window.__mockupDash.runPipeline() runs the same
 * logic with no timers so it can be asserted deterministically. */

import { openDom } from './lib/page.mjs';

export const name = 'Mockup — Variation B (dashboard pipeline trace)';

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

        const api = window.__mockupDash;
        t.ok('the page exposes window.__mockupDash', !!api);
        if (!api || !api.runPipeline) return;

        t.section('Progress indicator');

        t.eq('a five-dot progress row is present', document.querySelectorAll('.pipeline-progress .dot').length, 5);

        t.section('runPipeline() — deterministic, no timers');

        api.runPipeline();

        t.ok('isComplete() reports true', api.isComplete());
        t.eq('all five step cards rendered', document.querySelectorAll('.pipeline-step').length, 5);
        t.eq('all five step cards are visible', document.querySelectorAll('.pipeline-step.visible').length, 5);

        const who = Array.from(document.querySelectorAll('.pipeline-step .who')).map((el) => el.textContent);
        t.eq('the five assistants ran in the documented order', who.join(' | '),
            'Research Assistant | Client Tracker | Checklist Builder | Second-Look Reviewer | Memo Writer');

        t.section('"View result" only unlocks once the trace has finished');

        const resultLink = document.querySelector('a[href="mockup-dash-result.html"]');
        t.ok('a link to the result page exists', !!resultLink);
        if (resultLink) {
            const disabledViaAttr = resultLink.hasAttribute('disabled') || resultLink.getAttribute('aria-disabled') === 'true';
            const disabledViaClass = resultLink.classList.contains('disabled');
            t.ok('the result link is not left disabled once the pipeline has completed', !disabledViaAttr && !disabledViaClass);
        }
    } finally {
        env.close();
    }
}
