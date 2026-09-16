/* Pure-math tests for tricalc.html.
 *
 * These exercise the DOM-free block the page marks with
 * `===== PURE MATH START / END =====`. Every expected value below was derived
 * independently of the page's own code (see the comment on each group), so
 * these fail if the engine drifts rather than merely changing shape.
 */

import { extractPureMath } from './lib/harness.mjs';

export const name = 'tricalc — pure math';

const EXPORTS = [
    'toMeters', 'fromMeters', 'secondsFromPace', 'secondsFromSpeed',
    'convertPace', 'convertSpeed', 'convertDistance',
    'formatTime', 'formatPace', 'clockAt', 'computePlan', 'tidyDistance', 'METERS'
];

// A blank plan; each test fills in only the legs it cares about.
const plan = (overrides = {}) => ({
    swim: { dist: 0, distUnit: 'mi', pace: 0, paceUnit: '100yd' },
    bike: { dist: 0, distUnit: 'mi', speed: 0, speedUnit: 'mph' },
    run: { dist: 0, distUnit: 'mi', pace: 0, paceUnit: 'mi' },
    t1: 0, t2: 0, startTime: '07:00',
    ...overrides
});

export default async function run(t, page) {
    const source = extractPureMath(page.html, EXPORTS);
    if (!source) {
        t.section('tricalc — pure math');
        t.ok('page exposes a PURE MATH block (markers present)', false);
        return;
    }
    const C = new Function(source)();

    t.section('Unit conversion primitives');
    // Reference values: 1 mi = 1609.344 m and 1 yd = 0.9144 m are exact by
    // international definition (1959 international yard and pound agreement).
    t.near('1 mile in meters', C.toMeters(1, 'mi'), 1609.344, 1e-9);
    t.near('100 yards in meters', C.toMeters(100, 'yd'), 91.44, 1e-9);
    t.near('5 km to miles', C.convertDistance(5, 'km', 'mi'), 5 / 1.609344, 1e-9);
    t.near('1:45 /100yd to /100m', C.convertPace(105, '100yd', '100m'), 105 * 100 / 91.44, 1e-9);
    t.near('8:30 /mi to /km', C.convertPace(510, 'mi', 'km'), 510 * 1000 / 1609.344, 1e-9);
    t.near('19.3 mph to km/h', C.convertSpeed(19.3, 'mph', 'kmh'), 19.3 * 1.609344, 1e-9);
    t.near('mph round trip is lossless', C.convertSpeed(C.convertSpeed(19.3, 'mph', 'kmh'), 'kmh', 'mph'), 19.3, 1e-9);
    t.near('pace round trip is lossless', C.convertPace(C.convertPace(510, 'mi', 'km'), 'km', 'mi'), 510, 1e-9);

    t.section('Segment math across mismatched units');
    // Regression guard: before TriCalc 4.0 the engine assumed a leg's distance
    // was in the same unit as its pace, so these five cases were all wrong.
    t.eq('3800 m swim @ 1:45 /100m', C.formatTime(C.secondsFromPace(3800, 105, '100m')), '01:06:30');
    t.eq('3800 m swim @ 1:45 /100yd', C.formatTime(C.secondsFromPace(3800, 105, '100yd')), '01:12:44');
    t.eq('2.4 mi swim @ 1:45 /100yd', C.formatTime(C.secondsFromPace(C.toMeters(2.4, 'mi'), 105, '100yd')), '01:13:55');
    t.eq('180 km bike @ 19.3 mph', C.formatTime(C.secondsFromSpeed(180000, 19.3, 'mph')), '05:47:43');
    t.eq('42.195 km run @ 8:30 /mi', C.formatTime(C.secondsFromPace(42195, 510, 'mi')), '03:42:52');
    t.eq('42.195 km run @ 8:30 /km', C.formatTime(C.secondsFromPace(42195, 510, 'km')), '05:58:39');

    t.section('Bad input cannot corrupt a result');
    t.eq('zero speed yields zero time', C.secondsFromSpeed(100000, 0, 'mph'), 0);
    t.eq('zero pace yields zero time', C.secondsFromPace(100000, 0, 'mi'), 0);
    t.eq('negative distance clamps to zero', C.toMeters(-5, 'mi'), 0);
    t.eq('non-numeric distance clamps to zero', C.toMeters('abc', 'mi'), 0);
    t.eq('unknown unit yields zero', C.toMeters(5, 'furlong'), 0);
    t.eq('formatTime(NaN)', C.formatTime(NaN), '00:00:00');
    t.eq('formatTime(-10)', C.formatTime(-10), '00:00:00');
    t.eq('formatTime(Infinity)', C.formatTime(Infinity), '00:00:00');
    t.eq('formatPace(0)', C.formatPace(0), '--:--');

    t.section('Clock arithmetic');
    t.eq('07:00 plus 10:48:48', C.clockAt('07:00', 38928).text, '05:48:48 PM');
    t.eq('crossing midnight', C.clockAt('23:30', 3600).short, '12:30 AM');
    t.eq('rollover reports one day', C.clockAt('06:00', 26 * 3600).dayOffset, 1);
    t.eq('rollover clock face', C.clockAt('06:00', 26 * 3600).short, '08:00 AM');
    t.eq('noon reads PM', C.clockAt('12:00', 0).short, '12:00 PM');
    t.eq('midnight reads AM', C.clockAt('00:00', 0).short, '12:00 AM');
    t.eq('empty start time is safe', C.clockAt('', 0).short, '12:00 AM');
    t.eq('garbage start time is safe', C.clockAt('99:99', 0).short, '11:59 PM');

    t.section('Whole-plan invariants');
    const imperial = C.computePlan(plan({
        swim: { dist: 2.4, distUnit: 'mi', pace: 105, paceUnit: '100yd' },
        bike: { dist: 112, distUnit: 'mi', speed: 19.3, speedUnit: 'mph' },
        run: { dist: 26.2, distUnit: 'mi', pace: 510, paceUnit: 'mi' },
        t1: 120, t2: 120
    }));
    t.eq('default Ironman total', C.formatTime(imperial.totalSecs), '10:48:48');
    t.eq('final elapsed equals sum of splits', imperial.rows[4].elapsed, imperial.totalSecs);
    t.eq('moving plus transitions equals total', imperial.movingSecs + imperial.transitionSecs, imperial.totalSecs);
    t.ok('elapsed column increases monotonically', imperial.rows.every((r, i, a) => i === 0 || r.elapsed >= a[i - 1].elapsed));

    // The same athlete entered entirely in other units must finish at the same time.
    const mixed = C.computePlan(plan({
        swim: { dist: 2.4 * 1760, distUnit: 'yd', pace: 105, paceUnit: '100yd' },
        bike: { dist: 112 * 1.609344, distUnit: 'km', speed: 19.3, speedUnit: 'mph' },
        run: { dist: 26.2 * 1.609344, distUnit: 'km', pace: 510, paceUnit: 'mi' },
        t1: 120, t2: 120
    }));
    t.near('same plan in mixed units matches', mixed.totalSecs, imperial.totalSecs, 2);

    t.section('Long and single-sport races');
    const ultra = C.computePlan(plan({ run: { dist: 100, distUnit: 'mi', pace: 870, paceUnit: 'mi' } }));
    t.eq('100 mi @ 14:30 /mi exceeds 24 h', C.formatTime(ultra.totalSecs), '24:10:00');
    t.eq('and reports a day rollover', C.clockAt('04:00', ultra.totalSecs).dayOffset, 1);
    t.eq('5K @ 4:30 /km', C.formatTime(C.computePlan(plan({ run: { dist: 5, distUnit: 'km', pace: 270, paceUnit: 'km' } })).totalSecs), '00:22:30');

    t.section('Incomplete legs are reported, not silently dropped');
    t.eq('distance without a speed is flagged', C.computePlan(plan({ bike: { dist: 50, distUnit: 'mi', speed: 0, speedUnit: 'mph' } })).issues.join(','), 'bike');
    t.eq('distance without a pace is flagged', C.computePlan(plan({ run: { dist: 10, distUnit: 'mi', pace: 0, paceUnit: 'mi' } })).issues.join(','), 'run');
    t.eq('an empty plan raises no false alarms', C.computePlan(plan()).issues.length, 0);
}
