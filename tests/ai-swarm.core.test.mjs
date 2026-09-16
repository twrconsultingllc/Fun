/* ai-swarm.html — the DOM-free half.
 *
 * Two things are under test here. The first is the layout contract the page
 * makes in its own copy: "the strongest sit at the core, capability falls away
 * toward the rim". That is a claim about a function, so it is checked as one.
 * The second is the dataset itself — 100-odd models whose lineage, dates and
 * prices have to stay internally consistent, because nothing on screen will
 * tell you when they stop being.
 *
 * Every expected number below was derived by hand from the stated constants,
 * not read off the page. If one of these fails, re-derive it before touching it.
 */

import { extractPureMath } from './lib/harness.mjs';

export const name = 'AI Swarm — layout math & model catalogue';

const EXPORTS = [
    'MODELS', 'PROVIDERS', 'STATUSES', 'STATUS_LABEL',
    'radiusForPower', 'fibDirection', 'hash01', 'normalize', 'nodePosition', 'nodeRadius',
    'formatTokens', 'formatPrice', 'costForJob', 'formatUSD',
    'monthIndex', 'monthLabel', 'formatDate', 'buildLayout',
    'R_CORE', 'R_RIM', 'FALLOFF', 'EPOCH_YEAR'
];

export default async function run(t, page) {
    const source = extractPureMath(page.html, EXPORTS);
    if (!source) {
        t.ok('PURE MATH markers are present in ai-swarm.html', false);
        t.note('The core suite cannot run without them — see tests/README.md.');
        return;
    }

    let M;
    try {
        M = new Function(source)();
    } catch (error) {
        t.ok('the pure-math block evaluates', false);
        t.note(error.message);
        return;
    }
    t.ok('the pure-math block evaluates', true);

    /* ---------------------------------------------------------------- */
    t.section('The core-to-rim contract');

    /* Both endpoints follow directly from the declared constants:
       power 100 -> (1-1)^FALLOFF = 0 -> R_CORE;  power 0 -> 1^FALLOFF = 1 -> R_RIM. */
    t.eq('the strongest possible model sits exactly at the core radius', M.radiusForPower(100), M.R_CORE);
    t.eq('the weakest possible model sits exactly at the rim radius', M.radiusForPower(0), M.R_RIM);
    t.eq('R_CORE is much closer in than R_RIM', M.R_CORE < M.R_RIM, true);

    /* 0.5^1.35 = e^(1.35 · ln0.5) = e^-0.9357487 = 0.3922938.
       7 + 0.3922938 × (118 − 7) = 7 + 43.5446 = 50.5446 */
    t.near('power 50 lands at the hand-derived radius', M.radiusForPower(50), 50.5446, 0.002);

    /* Out-of-range scores must not throw the layout out of the sphere. */
    t.eq('scores above 100 are clamped to the core', M.radiusForPower(140), M.R_CORE);
    t.eq('negative scores are clamped to the rim', M.radiusForPower(-20), M.R_RIM);

    let monotonic = true;
    for (let p = 0; p < 100; p++) {
        if (!(M.radiusForPower(p + 1) < M.radiusForPower(p))) monotonic = false;
    }
    t.ok('radius strictly decreases for every one-point gain in power', monotonic);

    /* nodeRadius(0) = 0.55 + 0^3.1 × 2.6 = 0.55;  nodeRadius(100) = 0.55 + 2.6 = 3.15
       nodeRadius(50) = 0.55 + 0.5^3.1 × 2.6 = 0.55 + 0.116628 × 2.6 = 0.853233 */
    t.near('the smallest node is 0.55 across', M.nodeRadius(0), 0.55, 1e-9);
    t.near('the largest node is 3.15 across', M.nodeRadius(100), 3.15, 1e-9);
    t.near('a mid-tier node is the hand-derived size', M.nodeRadius(50), 0.853233, 0.0005);

    /* ---------------------------------------------------------------- */
    t.section('Direction vectors');

    const N = 64;
    let unit = true, sumX = 0, sumY = 0, sumZ = 0;
    for (let i = 0; i < N; i++) {
        const v = M.fibDirection(i, N);
        const len = Math.hypot(v.x, v.y, v.z);
        if (Math.abs(len - 1) > 1e-6) unit = false;
        sumX += v.x; sumY += v.y; sumZ += v.z;
    }
    t.ok('every Fibonacci direction is a unit vector', unit);
    t.near('the directions cancel out, so they are evenly spread', Math.hypot(sumX, sumY, sumZ) / N, 0, 0.02);

    const h1 = M.hash01('claude-opus-5', 1);
    t.ok('hash01 returns a value in [0, 1)', h1 >= 0 && h1 < 1);
    t.eq('hash01 is deterministic, so the layout is stable across reloads', M.hash01('claude-opus-5', 1), h1);
    t.ok('hash01 separates salts', M.hash01('claude-opus-5', 2) !== h1);

    const n = M.normalize({ x: 3, y: 4, z: 0 });
    t.near('normalize scales 3-4-0 to unit length', Math.hypot(n.x, n.y, n.z), 1, 1e-12);
    t.near('normalize preserves direction (x)', n.x, 0.6, 1e-12);
    t.eq('normalize does not divide by zero', Number.isFinite(M.normalize({ x: 0, y: 0, z: 0 }).x), true);

    /* ---------------------------------------------------------------- */
    t.section('Node placement');

    const layout = M.buildLayout(M.MODELS, M.PROVIDERS);
    t.eq('every model is placed', layout.nodes.length, M.MODELS.length);

    /* nodePosition squashes y by 0.72 to make a disc; undo that and the point
       must sit exactly on the sphere of its power-derived radius. */
    let onShell = true, worst = 0;
    for (const node of layout.nodes) {
        const want = M.radiusForPower(node.model.power);
        const got = Math.hypot(node.pos.x, node.pos.y / 0.72, node.pos.z);
        worst = Math.max(worst, Math.abs(got - want));
        if (Math.abs(got - want) > 1e-6) onShell = false;
    }
    t.ok('every node sits on the shell its power score demands', onShell);
    t.near('largest deviation from the shell', worst, 0, 1e-6);

    /* The headline claim of the whole page, checked over every pair. */
    let inversions = 0;
    const sorted = layout.nodes.slice().sort((a, b) => b.model.power - a.model.power);
    for (let i = 1; i < sorted.length; i++) {
        const prev = M.radiusForPower(sorted[i - 1].model.power);
        const here = M.radiusForPower(sorted[i].model.power);
        if (here < prev) inversions++;
    }
    t.eq('no weaker model is ever closer to the core than a stronger one', inversions, 0);

    const top = layout.ranked[0];
    const bottom = layout.ranked[layout.ranked.length - 1];
    t.ok(`the top model (${top.name}) outranks the last (${bottom.name})`, top.power > bottom.power);
    t.eq('rank 1 is assigned to the highest power score', layout.rankOf[top.id], 1);
    t.eq('the last rank equals the model count', layout.rankOf[bottom.id], M.MODELS.length);

    let ranksDescend = true;
    for (let i = 1; i < layout.ranked.length; i++) {
        if (layout.ranked[i].power > layout.ranked[i - 1].power) ranksDescend = false;
    }
    t.ok('the ranking is sorted by power, strongest first', ranksDescend);

    /* ---------------------------------------------------------------- */
    t.section('Formatting');

    t.eq('1,000,000 tokens reads as 1M', M.formatTokens(1000000), '1M');
    t.eq('1,048,576 tokens rounds to 1M', M.formatTokens(1048576), '1M');
    t.eq('2,097,152 tokens reads as 2.1M', M.formatTokens(2097152), '2.1M');
    t.eq('10,000,000 tokens drops the decimal', M.formatTokens(10000000), '10M');
    t.eq('200,000 tokens reads as 200K', M.formatTokens(200000), '200K');
    t.eq('65,536 tokens rounds to 66K', M.formatTokens(65536), '66K');
    t.eq('512 tokens is left alone', M.formatTokens(512), '512');
    t.eq('an unpublished context window formats as null', M.formatTokens(null), null);

    t.eq('$10 drops the cents', M.formatPrice(10), '$10');
    t.eq('$2.19 keeps them', M.formatPrice(2.19), '$2.19');
    t.eq('$1.25 keeps them', M.formatPrice(1.25), '$1.25');
    t.eq('$0.10 shows two places', M.formatPrice(0.1), '$0.10');
    t.eq('$0.075 shows three, or it would read as free', M.formatPrice(0.075), '$0.075');
    t.eq('an unpriced model formats as null', M.formatPrice(null), null);

    /* 1M in + 100K out at $10/$50 = 10 + 5 = $15 */
    t.near('the sample job on a $10/$50 model costs $15', M.costForJob(10, 50, 1000000, 100000), 15, 1e-9);
    /* at $5/$25 = 5 + 2.5 = $7.50 */
    t.near('the sample job on a $5/$25 model costs $7.50', M.costForJob(5, 25, 1000000, 100000), 7.5, 1e-9);
    /* at $0.20/$1.20 = 0.2 + 0.12 = $0.32 */
    t.near('the sample job on a $0.20/$1.20 model costs $0.32', M.costForJob(0.2, 1.2, 1000000, 100000), 0.32, 1e-9);
    t.eq('an unpriced model has no job cost', M.costForJob(null, null, 1000000, 100000), null);

    t.eq('$15 formats to the cent', M.formatUSD(15), '$15.00');
    t.eq('$7.50 keeps its cents', M.formatUSD(7.5), '$7.50');
    t.eq('sub-dollar costs get a third place', M.formatUSD(0.32), '$0.320');
    t.eq('costs over $100 drop the cents', M.formatUSD(120), '$120');

    /* Months since Jan 2018. 2026-09 is (2026−2018)×12 + 8 = 104. */
    t.eq('January 2018 is month zero', M.monthIndex('2018-01-01'), 0);
    t.eq('September 2026 is month 104', M.monthIndex('2026-09-10'), 104);
    t.eq('March 2023 is month 62', M.monthIndex('2023-03-14'), 62);
    t.eq('month 0 labels as Jan 2018', M.monthLabel(0), 'Jan 2018');
    t.eq('month 104 labels as Sep 2026', M.monthLabel(104), 'Sep 2026');
    t.eq('month 62 labels as Mar 2023', M.monthLabel(62), 'Mar 2023');

    t.eq('an exact date spells the month out', M.formatDate('2026-09-03', false), '3 September 2026');
    t.eq('an approximate date drops the day and says so', M.formatDate('2026-08-15', true), '≈ August 2026');

    /* ---------------------------------------------------------------- */
    t.section('Catalogue integrity');

    const ids = M.MODELS.map((m) => m.id);
    t.eq('every model id is unique', new Set(ids).size, ids.length);
    t.note(`${M.MODELS.length} models across ${Object.keys(M.PROVIDERS).length} labs`);

    const idSet = new Set(ids);
    const known = (field, ok) => M.MODELS.filter((m) => !ok(m)).map((m) => `${m.id}.${field}`);

    t.eq('every model belongs to a lab in the legend', known('p', (m) => !!M.PROVIDERS[m.p]).join(', ') || 'none', 'none');
    t.eq('every status has a chip and a label', known('status', (m) => M.STATUSES.includes(m.status) && M.STATUS_LABEL[m.status]).join(', ') || 'none', 'none');
    t.eq('every power score is in range', known('power', (m) => m.power >= 0 && m.power <= 100).join(', ') || 'none', 'none');
    t.eq('every model has a note worth reading', known('note', (m) => typeof m.note === 'string' && m.note.length > 60).join(', ') || 'none', 'none');
    t.eq('every model has an org name', known('org', (m) => typeof m.org === 'string' && m.org.length > 1).join(', ') || 'none', 'none');

    const badDate = M.MODELS.filter((m) => !/^\d{4}-\d{2}-\d{2}$/.test(m.released));
    t.eq('every release date is a full ISO date', badDate.map((m) => m.id).join(', ') || 'none', 'none');

    const early = M.MODELS.filter((m) => M.monthIndex(m.released) < 0);
    t.eq('nothing predates the timeline epoch', early.map((m) => m.id).join(', ') || 'none', 'none');

    /* The page is a snapshot; nothing in it may be dated into the future. */
    const now = new Date();
    const nowMonth = (now.getUTCFullYear() - M.EPOCH_YEAR) * 12 + now.getUTCMonth();
    const future = M.MODELS.filter((m) => M.monthIndex(m.released) > nowMonth);
    t.eq('nothing is dated after the current month', future.map((m) => m.id).join(', ') || 'none', 'none');

    /* Pricing is a pair or it is absent — a half-priced model renders wrong. */
    const halfPriced = M.MODELS.filter((m) => {
        const hasIn = m.pin !== null && m.pin !== undefined;
        const hasOut = m.pout !== null && m.pout !== undefined;
        return hasIn !== hasOut;
    });
    t.eq('no model has an input price without an output price', halfPriced.map((m) => m.id).join(', ') || 'none', 'none');

    const inverted = M.MODELS.filter((m) => m.pin !== null && m.pin !== undefined && m.pout < m.pin);
    t.eq('output tokens never cost less than input tokens', inverted.map((m) => m.id).join(', ') || 'none', 'none');

    /* ---------------------------------------------------------------- */
    t.section('Lineage');

    const dangling = M.MODELS.filter((m) => m.parent && !idSet.has(m.parent));
    t.eq('every parent reference resolves to a real model', dangling.map((m) => `${m.id}->${m.parent}`).join(', ') || 'none', 'none');

    const selfParent = M.MODELS.filter((m) => m.parent === m.id);
    t.eq('no model is its own parent', selfParent.map((m) => m.id).join(', ') || 'none', 'none');

    /* A cycle would hang the detail panel's lineage walk. */
    const byId = Object.fromEntries(M.MODELS.map((m) => [m.id, m]));
    const cyclic = M.MODELS.filter((m) => {
        const seen = new Set();
        let cur = m;
        while (cur && cur.parent) {
            if (seen.has(cur.id)) return true;
            seen.add(cur.id);
            cur = byId[cur.parent];
        }
        return false;
    });
    t.eq('no lineage chain loops back on itself', cyclic.map((m) => m.id).join(', ') || 'none', 'none');

    /* A model cannot descend from something released after it. */
    const backwards = M.MODELS.filter((m) => m.parent && byId[m.parent] &&
        M.monthIndex(byId[m.parent].released) > M.monthIndex(m.released));
    t.eq('no model descends from a later release', backwards.map((m) => `${m.id}<-${m.parent}`).join(', ') || 'none', 'none');

    const roots = M.MODELS.filter((m) => !m.parent);
    t.ok(`the tree has ${roots.length} roots, so the lineage is not one chain`, roots.length > 1);
    t.ok('children are indexed for the detail panel', Object.keys(layout.children).length > 10);

    /* ---------------------------------------------------------------- */
    t.section('Anthropic figures, against the published catalogue');

    const claude = Object.fromEntries(M.MODELS.filter((m) => m.p === 'anthropic').map((m) => [m.id, m]));
    const priced = (id, pin, pout) => {
        t.eq(`${claude[id].name} is $${pin}/$${pout} per MTok`, `${claude[id].pin}/${claude[id].pout}`, `${pin}/${pout}`);
    };

    priced('fable-5-1', 10, 50);
    priced('opus-5', 5, 25);
    priced('opus-4-8', 5, 25);
    priced('sonnet-5', 2, 10);
    priced('sonnet-4-6', 3, 15);
    priced('haiku-4-5', 1, 5);
    priced('opus-4-5', 5, 25);
    priced('opus-4-1', 15, 75);

    t.eq('Fable 5.1 has a 1M context window', claude['fable-5-1'].ctx, 1000000);
    t.eq('Haiku 4.5 has a 200K context window', claude['haiku-4-5'].ctx, 200000);
    t.eq('Haiku 4.5 caps output at 64K', claude['haiku-4-5'].maxOut, 64000);
    t.eq('Opus 5 caps output at 128K', claude['opus-5'].maxOut, 128000);
    t.eq('Opus 4.1 is marked deprecated', claude['opus-4-1'].status, 'deprecated');
    t.eq('Sonnet 3.7 is marked retired', claude['sonnet-3-7'].status, 'retired');
    t.eq('Mythos 5.1 is marked restricted', claude['mythos-5-1'].status, 'restricted');
    t.eq('Mythos 5.1 matches Fable 5.1 on price', claude['mythos-5-1'].pin, claude['fable-5-1'].pin);

    /* The catalogue's aliases are complete as published. Appending a date to
       one of these is the exact mistake CLAUDE.md warns about, so pin it. */
    const ALIASES = {
        'fable-5-1': 'claude-fable-5-1',
        'fable-5': 'claude-fable-5',
        'mythos-5-1': 'claude-mythos-5-1',
        'opus-5': 'claude-opus-5',
        'opus-4-8': 'claude-opus-4-8',
        'opus-4-7': 'claude-opus-4-7',
        'opus-4-6': 'claude-opus-4-6',
        'sonnet-5': 'claude-sonnet-5',
        'sonnet-4-6': 'claude-sonnet-4-6'
    };
    for (const [id, alias] of Object.entries(ALIASES)) {
        t.eq(`${claude[id].name} uses the bare alias, with no date suffix`, claude[id].api, alias);
    }

    /* These three are published as dated full ids, not bare aliases. */
    t.eq('Haiku 4.5 carries its dated id', claude['haiku-4-5'].api, 'claude-haiku-4-5-20251001');
    t.eq('Opus 4.5 carries its dated id', claude['opus-4-5'].api, 'claude-opus-4-5-20251101');
    t.eq('Sonnet 4.5 carries its dated id', claude['sonnet-4-5'].api, 'claude-sonnet-4-5-20250929');

    /* The Fable tier is the top of the range; Opus sits below it at half the price. */
    t.ok('Fable 5.1 outranks Opus 5', claude['fable-5-1'].power > claude['opus-5'].power);
    t.ok('Opus 5 costs half what Fable 5.1 costs', claude['opus-5'].pin * 2 === claude['fable-5-1'].pin);
    t.ok('Opus 5 outranks Opus 4.8', claude['opus-5'].power > claude['opus-4-8'].power);
    t.ok('Sonnet 5 undercuts Sonnet 4.6 on input price', claude['sonnet-5'].pin < claude['sonnet-4-6'].pin);
    t.ok('Opus 4.5 is where Opus pricing fell to a third', claude['opus-4-5'].pin * 3 === claude['opus-4-1'].pin);

    /* ---------------------------------------------------------------- */
    t.section('Coverage');

    const byProvider = {};
    for (const m of M.MODELS) byProvider[m.p] = (byProvider[m.p] || 0) + 1;
    for (const key of Object.keys(M.PROVIDERS)) {
        t.ok(`${M.PROVIDERS[key].label} has at least one model in the swarm`, (byProvider[key] || 0) > 0);
    }

    const colours = Object.values(M.PROVIDERS).map((p) => p.color.toLowerCase());
    t.eq('every lab has a distinct colour', new Set(colours).size, colours.length);

    const orders = Object.values(M.PROVIDERS).map((p) => p.order);
    t.eq('every lab has a distinct arm', new Set(orders).size, orders.length);

    const frontier = M.MODELS.filter((m) => m.status === 'frontier');
    t.ok(`${frontier.length} models are marked frontier`, frontier.length >= 5);
    t.ok('every frontier model scores at least 80', frontier.every((m) => m.power >= 80));

    const openWeights = M.MODELS.filter((m) => m.open);
    t.ok(`${openWeights.length} models ship open weights`, openWeights.length >= 10);

    const oldest = M.MODELS.reduce((a, b) => (M.monthIndex(a.released) <= M.monthIndex(b.released) ? a : b));
    const newest = M.MODELS.reduce((a, b) => (M.monthIndex(a.released) >= M.monthIndex(b.released) ? a : b));
    t.note(`spans ${oldest.name} (${oldest.released}) to ${newest.name} (${newest.released})`);
    t.ok('the swarm spans at least seven years', M.monthIndex(newest.released) - M.monthIndex(oldest.released) >= 84);
}
