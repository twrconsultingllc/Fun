/* study/mockup-chat-home.html — Variation A (chat) of the Claude Architect Lab
 * product-UI mockups. A plain interactive page (no canvas/WebGL/Web Audio), so
 * it runs end to end under jsdom like tricalc.html/signal-scope.html do.
 *
 * The scripted Meridian pipeline normally reveals five chat bubbles ~600ms
 * apart; window.__mockupChat.runPipeline() runs the same logic with no
 * timers so the DOM state can be asserted deterministically. */

import { openDom } from './lib/page.mjs';

export const name = 'Mockup — Variation A (chat)';

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

        const api = window.__mockupChat;
        t.ok('the page exposes window.__mockupChat', !!api);
        if (!api) return;

        t.section('Chrome and navigation');

        t.eq('the appbar links to the clients page', document.querySelector('.appbar-nav a[href="mockup-chat-clients.html"]') ? 'present' : 'missing', 'present');
        t.eq('the rail links to the clients page', document.querySelector('.rail-link[href="mockup-chat-clients.html"]') ? 'present' : 'missing', 'present');
        t.ok('the disclaimer banner is present', !!document.querySelector('.mockup-banner'));
        t.ok('the three example prompts are present', document.querySelectorAll('.prompt-chip').length === 3);

        t.section('Before running the pipeline');

        t.eq('no pipeline steps are in the thread yet', document.querySelectorAll('.pipeline-step').length, 0);
        t.ok('isComplete() is false before anything runs', !api.isComplete());

        t.section('runPipeline() — the scripted Meridian scenario, no timers');

        api.runPipeline();

        t.ok('isComplete() is true once run instantly', api.isComplete());
        t.eq('all five assistant steps rendered', document.querySelectorAll('.pipeline-step').length, 5);
        t.eq('all five steps are marked visible', document.querySelectorAll('.pipeline-step.visible').length, 5);

        const who = Array.from(document.querySelectorAll('.pipeline-step .who')).map((el) => el.textContent);
        t.eq('the five assistants ran in the documented order', who.join(' | '),
            'Research Assistant | Client Tracker | Checklist Builder | Second-Look Reviewer | Memo Writer');

        t.section('The result bubble');

        const bodyText = document.body.textContent;
        t.ok('the result carries a Reviewed badge', bodyText.includes('Reviewed'));
        t.ok('the Texas checklist made it into the result table', bodyText.includes('Texas'));
        t.ok('the Florida checklist made it into the result table', bodyText.includes('Florida'));
        t.ok('the Illinois checklist made it into the result table', bodyText.includes('Illinois'));
        t.ok('a Copy memo button is present', !!document.querySelector('.copy-memo-btn'));

        t.section('sendPrompt() — a free-text message containing "Meridian" also runs the pipeline');

        // Fresh page state would be needed for a from-scratch run; here we only
        // confirm the hook exists and does not throw when called again.
        let threw = false;
        try { api.sendPrompt('Meridian again please'); } catch { threw = true; }
        t.ok('sendPrompt() does not throw on a second call', !threw);
    } finally {
        env.close();
    }
}
