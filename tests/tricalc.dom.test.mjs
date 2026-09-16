/* DOM tests for tricalc.html, driven through the real page in jsdom.
 *
 * These click buttons, type into fields and read rendered text, so they test
 * the page as an athlete uses it rather than testing internals. They also
 * check structural health (no missing element ids, no dead inline handlers)
 * which catches the usual breakages when the markup is rewritten.
 */

import { openDom, domHelpers } from './lib/page.mjs';

export const name = 'tricalc — page behavior';

export default async function run(t, page) {
    const { window, document, errors } = await openDom(page.html, page.url);
    const { $, text, type, pick, blur, secondsOf } = domHelpers(window);

    t.section('The page boots without errors');
    t.eq('no uncaught script errors', errors.join(' | ') || 'none', 'none');
    t.ok('calculation engine is reachable', typeof window.computePlan === 'function');
    t.ok('preset table is reachable', Array.isArray(window.PRESETS) && window.PRESETS.length > 0);

    t.section('Default Ironman plan renders end to end');
    t.eq('total time', text('topTotalDisplay'), '10:48:48');
    t.eq('projected finish clock', text('topClockDisplay'), '05:48 PM');
    t.eq('total distance', text('topDistanceDisplay'), '140.6 mi');
    t.eq('swim split', text('swimSplitChip'), '01:13:55');
    t.eq('bike split', text('bikeSplitChip'), '05:48:11');
    t.eq('run split', text('runSplitChip'), '03:42:42');
    t.eq('mobile bar mirrors the total', text('mobileTotal'), '10:48:48');
    t.eq('preset badge', text('presetLabelBadge'), 'Full Ironman');
    t.eq('five legs plus a total row', $('gadgetTableBody').querySelectorAll('tr').length, 6);
    t.eq('distribution bar has five segments', $('distBar').children.length, 5);

    t.section('The split table adds up');
    const rows = [...$('gadgetTableBody').querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => td.textContent.trim()));
    const splitSum = rows.slice(0, 5).reduce((sum, r) => sum + secondsOf(r[2]), 0);
    t.eq('splits sum to the final elapsed value', splitSum, secondsOf(rows[4][3]));
    t.eq('final elapsed matches the total row', rows[4][3], rows[5][3]);
    t.eq('total row repeats the headline total', rows[5][2], text('topTotalDisplay'));

    t.section('Editing recalculates and marks the plan custom');
    type('runPaceMin', 7);
    t.eq('total at a 7:30 /mi run', text('topTotalDisplay'), '10:22:36');
    t.eq('badge switches to custom', text('presetLabelBadge'), 'Custom Plan');
    type('runPaceMin', 8);
    t.eq('total restored', text('topTotalDisplay'), '10:48:48');

    t.section('Seconds fields normalize on blur');
    $('swimPaceSec').value = '90';
    blur('swimPaceSec');
    t.eq('1:90 becomes 2:30', `${$('swimPaceMin').value}:${$('swimPaceSec').value}`, '2:30');
    $('swimPaceMin').value = '1';
    $('swimPaceSec').value = '45';
    blur('swimPaceSec');

    t.section('The unit toggle converts rather than resetting');
    const beforeToggle = window.computePlan(window.state).totalSecs;
    window.setUnitSystem('metric');
    t.near('finish time survives the switch', window.computePlan(window.state).totalSecs, beforeToggle, 30);
    t.eq('swim distance is now km', $('swimDistUnit').value, 'km');
    t.eq('swim pace is now per 100 m', $('swimPaceUnit').value, '100m');
    t.eq('bike speed is now km/h', $('bikeSpeedUnit').value, 'kmh');
    t.eq('run pace is now per km', $('runPaceUnit').value, 'km');
    t.near('19.3 mph shown as 31.1 km/h', Number($('bikeSpeed').value), 31.1, 0.05);
    window.setUnitSystem('imperial');
    t.near('round trip returns the same finish', window.computePlan(window.state).totalSecs, beforeToggle, 30);
    t.eq('bike speed back to 19.3 mph', Number($('bikeSpeed').value), 19.3);

    t.section('Per-field unit dropdowns convert that field');
    const beforeSwap = window.computePlan(window.state).totalSecs;
    pick('runDistUnit', 'km');
    t.near('26.2 mi restated as 42.16 km', Number($('runDist').value), 42.16, 0.02);
    t.near('total is unaffected by the restatement', window.computePlan(window.state).totalSecs, beforeSwap, 2);
    pick('runDistUnit', 'mi');

    t.section('Mixed units stay correct');
    // The pre-4.0 engine reported 01:06:30 here by ignoring the /100yd pace unit.
    pick('swimDistUnit', 'm');
    type('swimDist', 3800);
    t.eq('3800 m swim at a 1:45 /100yd pace', text('swimSplitChip'), '01:12:44');
    pick('swimPaceUnit', '100m');
    t.eq('swapping the pace unit reconverts the pace', `${$('swimPaceMin').value}:${$('swimPaceSec').value}`, '1:55');
    t.near('and the split barely moves', window.computePlan(window.state).swimSecs, 4364, 20);

    t.section('Run-only presets hide the legs that are not raced');
    window.applyPreset('5k');
    t.eq('badge', text('presetLabelBadge'), '5K Run');
    t.eq('only a run row and a total row', $('gadgetTableBody').querySelectorAll('tr').length, 2);
    t.eq('5K at a 7:30 /mi pace', text('topTotalDisplay'), '00:23:20');
    t.eq('transitions are zero', text('statTransitions'), '00:00:00');

    t.section('Races past midnight are labelled');
    window.applyPreset('leadville');
    type('startTime', '06:00');
    t.eq('100 miles at 14:30 /mi', text('topTotalDisplay'), '24:10:00');
    t.ok('day-rollover badge is visible', !$('topDayBadge').classList.contains('hidden'));
    t.eq('badge text', text('topDayBadge'), '+1 day');

    t.section('A leg with no pace is flagged, not counted as zero');
    window.applyPreset('ironman');
    type('bikeSpeed', 0);
    t.ok('warning is shown', !$('inputWarning').classList.contains('hidden'));
    t.ok('warning names the bike speed', /bike speed/.test(text('inputWarning')));
    t.ok('the field is marked invalid', $('bikeSpeed').classList.contains('is-invalid'));
    type('bikeSpeed', 19.3);
    t.ok('warning clears once fixed', $('inputWarning').classList.contains('hidden'));

    t.section('Junk input never reaches the display');
    for (const [field, value] of [['swimDist', ''], ['swimDist', -5], ['runDist', 'abc'], ['bikeSpeed', 'e']]) {
        type(field, value);
        t.ok(`${field}="${value}" produces no NaN`, !/NaN|undefined/.test(text('topTotalDisplay') + text('statDistance')));
    }
    window.applyPreset('ironman');
    t.eq('page recovers after junk input', text('topTotalDisplay'), '10:48:48');

    t.section('Markup and script stay in sync');
    const referenced = [...new Set([...page.html.matchAll(/\bel\('([A-Za-z0-9_]+)'\)/g)].map((m) => m[1]))];
    t.eq('every element id the script looks up exists', referenced.filter((id) => !$(id)).join(', ') || 'none', 'none');
    const allIds = [...document.querySelectorAll('[id]')].map((n) => n.id);
    t.eq('no duplicate element ids', allIds.filter((v, i) => allIds.indexOf(v) !== i).join(', ') || 'none', 'none');
    const handlers = [...new Set([...page.html.matchAll(/on(?:click|change|input)="([A-Za-z0-9_]+)\(/g)].map((m) => m[1]))];
    t.eq(`every inline handler is defined (${handlers.length} found)`, handlers.filter((fn) => typeof window[fn] !== 'function').join(', ') || 'none', 'none');
    t.ok('viewport meta present (mobile scaling)', /name="viewport"[^>]*width=device-width/.test(page.html));
    t.ok('inputs are 16px on mobile (blocks iOS focus zoom)', /@media \(max-width: 767px\)[\s\S]{0,120}font-size: 16px/.test(page.html));

    t.section('Share links round-trip a plan');
    window.applyPreset('olympic');
    const shared = window.location.href.split('?')[0].split('#')[0] + '?' + window.planToParams().toString();
    const expectedTotal = text('topTotalDisplay');
    const restored = await openDom(page.html, shared, { collectErrors: false });
    t.eq('a shared link rebuilds the same total', restored.document.getElementById('topTotalDisplay').textContent.trim(), expectedTotal);
    t.eq('and the same preset label', restored.document.getElementById('presetLabelBadge').textContent.trim(), 'Olympic Tri');

    t.section('The last plan is remembered');
    window.applyPreset('half_ironman');
    type('runPaceMin', 9);
    // localStorage throws on opaque origins (file://) and in private browsing;
    // the page must keep working either way, so only assert storage when it exists.
    let storage = null;
    try { storage = window.localStorage; } catch { storage = null; }
    if (storage) {
        const saved = JSON.parse(storage.getItem('fc-tricalc-v4') || '{}');
        t.eq('run pace persisted', saved.run && saved.run.pace, 9 * 60 + 45);
    } else {
        t.note('localStorage unavailable on this origin — run with --target=<https url> to cover it');
        t.ok('page still calculates without storage', text('topTotalDisplay') !== '--:--:--');
    }

    t.section('Every preset agrees across unit systems');
    t.note('drift comes only from official distances differing (e.g. 3800 m vs 3862 m)');
    for (const preset of window.PRESETS) {
        window.setUnitSystem('imperial');
        window.applyPreset(preset.key);
        const imperialSecs = window.computePlan(window.state).totalSecs;
        window.setUnitSystem('metric');
        window.applyPreset(preset.key);
        const metricSecs = window.computePlan(window.state).totalSecs;
        const drift = imperialSecs ? Math.abs(metricSecs - imperialSecs) / imperialSecs * 100 : 100;
        t.ok(
            `${preset.key.padEnd(14)} ${window.formatTime(imperialSecs)} imperial / ${window.formatTime(metricSecs)} metric  (${drift.toFixed(2)}% drift)`,
            imperialSecs > 0 && drift < 2
        );
    }
    window.setUnitSystem('imperial');

    window.close();
    restored.window.close();
}
