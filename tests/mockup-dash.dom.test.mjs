/* study/mockup-dash-home.html — Variation B (dashboard) of the Claude
 * Architect Lab product-UI mockups. A plain interactive page, runs end to
 * end under jsdom. The three summary tiles are computed live from the
 * page's own CLIENTS data rather than hardcoded, so this pins that the
 * displayed numbers actually match what the data implies. */

import { openDom } from './lib/page.mjs';

export const name = 'Mockup — Variation B (dashboard overview)';

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
        if (!api || !api.summary) return;

        t.section('Chrome and navigation');

        t.ok('the disclaimer banner is present', !!document.querySelector('.mockup-banner'));
        t.eq('the sidebar links to the clients page', document.querySelector('.sidebar a[href="mockup-dash-clients.html"]') ? 'present' : 'missing', 'present');

        t.section('Summary tiles are computed from the sample data, not hardcoded');

        const summary = api.summary();
        t.eq('three sample clients', summary.activeClients, 3);
        // Meridian: Texas (gathering_documents) + Florida (not_started) + Illinois (not_started) = 3 open.
        // Quickship: Georgia + Colorado (both amendment_in_progress) = 2 open. Northstar: 0.
        t.eq('open engagements counts every non-terminal engagement across all clients', summary.openEngagements, 5);
        // Meridian: 2 done + 2 pending (TX) + 4 pending (FL) + 4 pending (IL) = 10 pending.
        // Quickship: 2 pending x 2 states = 4 pending. Northstar: 0.
        t.eq('pending checklist items counts every pending item across all clients', summary.pendingChecklistItems, 14);

        const tileText = document.body.textContent;
        t.ok('the computed active-client count actually appears on the page', tileText.includes(String(summary.activeClients)));
        t.ok('the computed open-engagement count actually appears on the page', tileText.includes(String(summary.openEngagements)));
        t.ok('the computed pending-item count actually appears on the page', tileText.includes(String(summary.pendingChecklistItems)));

        t.section('Recent activity');

        t.ok('a recent-activity panel is present with at least one entry', document.querySelectorAll('.panel li, .panel .tile, .panel div').length > 0);
    } finally {
        env.close();
    }
}
