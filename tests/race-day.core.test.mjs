/* race-day.html — the DOM-free half.
 *
 * Three things are under test here.
 *
 * The first is the race economy. The game is only worth playing if a good race
 * wins and a sloppy one does not, and that is a claim about arithmetic: five
 * leg times, a bonus, a penalty, and eight rivals with fixed finishing times.
 * Every expected number below is derived from the declared constants by hand
 * and written out longhand, so a failure here means the balance moved — not
 * that the test needs updating.
 *
 * The second is the checklist itself. Thirty-five questions that are supposed
 * to be answerable: four options, exactly one right, an explanation on every
 * one, and no duplicates. A quiz with a malformed question is a quiz that
 * cannot be won.
 *
 * The third is the inverse kinematics the pedal stroke runs on, which is
 * checkable the honest way: solve it, rebuild the limb from the angles it
 * returns, and see whether the foot landed on the pedal.
 */

import { extractPureMath } from './lib/harness.mjs';

export const name = 'Race Day — race economy, checklist and rig maths';

const EXPORTS = [
    'STAGES', 'BANK', 'RIVALS',
    'makeRng', 'shuffled', 'pickQuestions',
    'stageTime', 'partialStageTime', 'rivalStageTimes', 'rivalElapsed',
    'createRace', 'currentStage', 'currentQuestion', 'answerQuestion',
    'raceElapsed', 'courseFraction', 'positionNow', 'totalTime', 'scoreOf', 'finalResult',
    'formatClock', 'formatGap', 'ordinal', 'clamp', 'lerp', 'approach', 'ik2'
];

/* Play a whole race, getting the questions at `wrongAt` (0-based, over the
   twenty asked) deliberately wrong. */
function play(M, seed, wrongAt = []) {
    const race = M.createRace(seed);
    let asked = 0;
    let guard = 0;
    while (!race.finished && guard++ < 40) {
        const q = M.currentQuestion(race);
        const bad = wrongAt.includes(asked);
        M.answerQuestion(race, bad ? (q.a === 0 ? 1 : 0) : q.a);
        asked++;
    }
    return race;
}

export default async function run(t, page) {
    const source = extractPureMath(page.html, EXPORTS);
    if (!source) {
        t.ok('PURE MATH markers are present in race-day.html', false);
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

    /* ------------------------------------------------------------------ */
    t.section('The course');

    t.eq('the race is five legs', M.STAGES.length, 5);
    t.eq('the legs are in race order', M.STAGES.map((s) => s.id).join(','), 'swim,t1,bike,t2,run');
    t.eq('every leg asks four questions', M.STAGES.every((s) => s.questions === 4), true);
    t.eq('which is twenty questions in a race', M.STAGES.reduce((n, s) => n + s.questions, 0), 20);

    /* 1980 + 240 + 4560 + 180 + 3120 = 10080 */
    const baseTotal = M.STAGES.reduce((n, s) => n + s.base, 0);
    t.eq('an athlete who answers nothing takes 10080s (2:48:00)', baseTotal, 10080);
    t.eq('which formats as 2:48:00', M.formatClock(baseTotal), '2:48:00');

    /* ------------------------------------------------------------------ */
    t.section('Leg times');

    /* stageTime = base − bonus×correct + penalty×wrong, per leg, longhand: */
    const [swim, t1, bike, t2, runLeg] = M.STAGES;
    t.eq('a perfect swim is 1980 − 4×90 = 1620', M.stageTime(swim, 4, 0), 1620);
    t.eq('a perfect T1 is 240 − 4×20 = 160', M.stageTime(t1, 4, 0), 160);
    t.eq('a perfect bike is 4560 − 4×150 = 3960', M.stageTime(bike, 4, 0), 3960);
    t.eq('a perfect T2 is 180 − 4×15 = 120', M.stageTime(t2, 4, 0), 120);
    t.eq('a perfect run is 3120 − 4×110 = 2680', M.stageTime(runLeg, 4, 0), 2680);

    /* One wrong on the bike costs the 150 you did not save plus 100 penalty. */
    t.eq('three right and one wrong on the bike is 4560 − 450 + 100 = 4210',
        M.stageTime(bike, 3, 1), 4210);
    t.eq('so a single bike mistake is worth 250 seconds',
        M.stageTime(bike, 3, 1) - M.stageTime(bike, 4, 0), 250);

    /* Part-way through, the base scales with the questions answered, so the
       running clock is monotonic and lands exactly on stageTime at the end. */
    t.eq('half a perfect swim reads 1980×0.5 − 2×90 = 810', M.partialStageTime(swim, 2, 0, 2), 810);
    t.eq('and the last question lands exactly on the leg time',
        M.partialStageTime(swim, 4, 0, 4), M.stageTime(swim, 4, 0));
    t.eq('nothing answered yet means nothing on the clock', M.partialStageTime(swim, 0, 0, 0), 0);

    /* ------------------------------------------------------------------ */
    t.section('A perfect race');

    const perfect = play(M, 42);
    t.eq('twenty questions were asked', M.scoreOf(perfect).asked, 20);
    t.eq('and twenty were right', M.scoreOf(perfect).right, 20);
    t.eq('the race is finished', perfect.finished, true);
    t.eq('nothing went on the missed list', perfect.missed.length, 0);

    /* 1620 + 160 + 3960 + 120 + 2680 = 8540 */
    t.eq('a perfect race is 8540s', M.totalTime(perfect), 8540);
    t.eq('which is 2:22:20', M.formatClock(M.totalTime(perfect)), '2:22:20');

    const perfectResult = M.finalResult(perfect);
    t.eq('and it wins', perfectResult.place, 1);
    /* fastest rival 9100 − 8540 = 560 */
    t.eq('by 560 seconds over the fastest rival', perfectResult.gap, 560);
    t.eq('shown as +9:20', M.formatGap(perfectResult.gap), '+9:20');

    /* ------------------------------------------------------------------ */
    t.section('How much the race forgives');

    /* Every mistake on the swim costs the 90 not saved plus 60 penalty = 150.
       8540 + 150n against the fastest rival's 9100 puts the cliff between
       three mistakes (8990) and four (9140). */
    const swimMisses = (n) => M.totalTime(play(M, 7, [0, 1, 2, 3, 4].slice(0, n)));
    t.eq('one swim mistake is 8540 + 150 = 8690', swimMisses(1), 8690);
    t.eq('three swim mistakes is 8990 — still under the fastest rival', swimMisses(3), 8990);
    t.eq('and that still wins', M.finalResult(play(M, 7, [0, 1, 2])).place, 1);
    t.eq('four swim mistakes is 9140 — past 9100', swimMisses(4), 9140);
    t.eq('and that is second', M.finalResult(play(M, 7, [0, 1, 2, 3])).place, 2);

    /* The bike is where a mistake actually hurts: 250 a time, so two of them
       cost more than three on the swim. */
    const twoOnTheBike = M.totalTime(play(M, 7, [8, 9]));
    t.eq('two bike mistakes is 8540 + 500 = 9040', twoOnTheBike, 9040);
    t.eq('three bike mistakes loses the race', M.finalResult(play(M, 7, [8, 9, 10])).place, 2);

    const worst = play(M, 7, [...Array(20).keys()]);
    t.eq('getting everything wrong asks twenty questions all the same', M.scoreOf(worst).asked, 20);
    t.eq('and puts twenty items on the checklist recap', worst.missed.length, 20);
    t.eq('the field is not beaten by an athlete who knows nothing',
        M.finalResult(worst).place > 3, true);

    /* ------------------------------------------------------------------ */
    t.section('The field');

    t.eq('there are eight rivals', M.RIVALS.length, 8);
    t.eq('with distinct bib numbers', new Set(M.RIVALS.map((r) => r.bib)).size, 8);
    t.eq('and distinct finishing times', new Set(M.RIVALS.map((r) => r.total)).size, 8);
    t.eq('the fastest of them finishes in 9100s', Math.min(...M.RIVALS.map((r) => r.total)), 9100);

    /* A rival's leg times are weighted by their profile and then normalised,
       so however the weights are tuned the legs still add up to the total. */
    let normalised = true;
    for (const rival of M.RIVALS) {
        const legs = M.rivalStageTimes(rival);
        if (legs.length !== 5) normalised = false;
        if (Math.abs(legs.reduce((a, b) => a + b, 0) - rival.total) > 1e-6) normalised = false;
    }
    t.ok('every rival’s legs add back up to their finishing time', normalised);

    /* Bib 7 is the swim specialist: profile 0.86 on the swim, so their swim
       split has to be quicker than the even-paced Bib 41's, who is on 1.00. */
    const specialist = M.rivalStageTimes(M.RIVALS.find((r) => r.bib === 7));
    const even = M.rivalStageTimes(M.RIVALS.find((r) => r.bib === 41));
    t.ok('the swim specialist swims quicker than the even-paced rival', specialist[0] < even[0]);
    t.ok('and gives it back on the bike', specialist[2] / 9100 > even[2] / 9750);

    t.eq('a rival at the start of the race has no time on the clock',
        M.rivalElapsed(M.RIVALS[0], 0, 0), 0);
    t.near('and at the end has all of it',
        M.rivalElapsed(M.RIVALS[0], 4, 1), M.RIVALS[0].total, 1e-6);

    /* ------------------------------------------------------------------ */
    t.section('Position and progress');

    const midRace = M.createRace(3);
    t.eq('at the gun, nobody is ahead of you', M.positionNow(midRace), 1);
    t.eq('and no distance is covered', M.courseFraction(midRace), 0);

    /* Four legs of a race that answers nothing: the course fraction is the
       share of the base time behind you — (1980+240+4560+180)/10080. */
    const drifting = play(M, 3, [...Array(20).keys()]);
    t.eq('a finished race is all the way round the course', M.courseFraction(drifting), 1);
    t.eq('and a finished perfect race is too', M.courseFraction(perfect), 1);

    const halfway = M.createRace(3);
    for (let i = 0; i < 4; i++) M.answerQuestion(halfway, M.currentQuestion(halfway).a);
    t.near('after a perfect swim the course is 1980/10080 done',
        M.courseFraction(halfway), 1980 / 10080, 1e-9);
    t.eq('and the clock reads the perfect swim split', M.raceElapsed(halfway), 1620);
    /* Even a perfect swim does not lead out of the water. Bib 7 is the swim
       specialist — profile 0.86 against a 9100 finish puts their swim at about
       25:35, ahead of the 27:00 a flawless swim leg is worth. Exactly one
       rival is up the road, so second. */
    t.eq('but the swim specialist is still up the road', M.positionNow(halfway), 2);
    const aheadOutOfTheWater = M.RIVALS.filter((r) => M.rivalStageTimes(r)[0] < 1620);
    t.eq('and it is Bib 7, on their own', aheadOutOfTheWater.map((r) => r.bib).join(','), '7');

    /* ------------------------------------------------------------------ */
    t.section('The checklist');

    const legs = Object.keys(M.BANK);
    t.eq('every leg has a question pool', legs.join(','), 'swim,t1,bike,t2,run');
    t.eq('thirty-five questions in total',
        legs.reduce((n, id) => n + M.BANK[id].length, 0), 35);

    let wellFormed = true, hasWhy = true, answerInRange = true;
    const texts = new Set();
    let duplicates = 0;
    for (const id of legs) {
        if (M.BANK[id].length < M.STAGES.find((s) => s.id === id).questions) wellFormed = false;
        for (const q of M.BANK[id]) {
            if (!Array.isArray(q.opts) || q.opts.length !== 4) wellFormed = false;
            if (!(q.a >= 0 && q.a < 4)) answerInRange = false;
            if (!q.why || q.why.length < 40) hasWhy = false;
            if (new Set(q.opts).size !== q.opts.length) wellFormed = false;
            if (texts.has(q.q)) duplicates++;
            texts.add(q.q);
        }
    }
    t.ok('every question offers exactly four distinct options', wellFormed);
    t.ok('every question points at one of them', answerInRange);
    t.ok('and every question explains itself', hasWhy);
    t.eq('no question is asked twice', duplicates, 0);
    t.ok('every pool can fill its leg without repeating',
        legs.every((id) => M.BANK[id].length >= M.STAGES.find((s) => s.id === id).questions));

    /* ------------------------------------------------------------------ */
    t.section('Drawing a race');

    const drawA = M.pickQuestions(1234);
    const drawB = M.pickQuestions(1234);
    const drawC = M.pickQuestions(1235);

    t.eq('a seed draws four questions a leg',
        legs.every((id) => drawA[id].length === 4), true);
    t.eq('the same seed draws the same race',
        JSON.stringify(drawA) === JSON.stringify(drawB), true);
    t.eq('a different seed draws a different one',
        JSON.stringify(drawA) === JSON.stringify(drawC), false);

    let noRepeats = true, answersTrack = true;
    for (const id of legs) {
        const asked = drawA[id].map((q) => q.q);
        if (new Set(asked).size !== asked.length) noRepeats = false;
        /* Options are shuffled, so the recorded answer index has to have moved
           with the text it belongs to. */
        for (const q of drawA[id]) {
            const original = M.BANK[id].find((o) => o.q === q.q);
            if (!original || q.opts[q.a] !== original.opts[original.a]) answersTrack = false;
        }
    }
    t.ok('a leg never asks the same question twice in one race', noRepeats);
    t.ok('shuffling the options carries the right answer with it', answersTrack);

    /* The answer must not sit in the same slot every time, or the game is
       "always press 1". Across all 20 drawn questions of several seeds, every
       slot should come up. */
    const slots = new Set();
    for (let seed = 0; seed < 12; seed++) {
        const draw = M.pickQuestions(seed);
        for (const id of legs) for (const q of draw[id]) slots.add(q.a);
    }
    t.eq('the right answer lands in all four slots across seeds', slots.size, 4);

    /* ------------------------------------------------------------------ */
    t.section('Answering');

    const race = M.createRace(99);
    const first = M.currentQuestion(race);
    const right = M.answerQuestion(race, first.a);
    t.eq('a right answer is reported as correct', right.correct, true);
    t.eq('and is worth the leg bonus', right.delta, -90);
    t.eq('the clock moved to a quarter of the swim, less the bonus',
        M.raceElapsed(race), 1980 * 0.25 - 90);

    const second = M.currentQuestion(race);
    t.ok('the next question is a different one', second.q !== first.q);
    const wrong = M.answerQuestion(race, second.a === 0 ? 1 : 0);
    t.eq('a wrong answer is reported as such', wrong.correct, false);
    t.eq('and costs the leg penalty', wrong.delta, 60);
    t.eq('it goes on the checklist recap', race.missed.length, 1);
    t.eq('with the answer that was right', race.missed[0].answer, second.opts[second.a]);
    t.eq('and the leg it came from', race.missed[0].stage, 'Swim');

    M.answerQuestion(race, M.currentQuestion(race).a);
    t.eq('the leg is not over yet', M.currentStage(race).id, 'swim');
    const closer = M.answerQuestion(race, M.currentQuestion(race).a);
    t.eq('the fourth answer closes the leg', closer.stageDone, true);
    t.eq('and the race moves to T1', M.currentStage(race).id, 't1');
    /* 1980 − 3×90 + 1×60 = 1770 */
    t.eq('the swim split was written down', race.legs[0].time, 1770);
    t.eq('the question counter restarted', race.qIndex, 0);

    const done = play(M, 99);
    t.eq('answering a finished race does nothing', M.answerQuestion(done, 0), null);

    /* ------------------------------------------------------------------ */
    t.section('Formatting');

    t.eq('the clock is h:mm:ss', M.formatClock(8540), '2:22:20');
    t.eq('under an hour still shows the hour', M.formatClock(95), '0:01:35');
    t.eq('seconds are padded', M.formatClock(3605), '1:00:05');
    t.eq('negative time is floored at zero', M.formatClock(-40), '0:00:00');

    t.eq('a gap ahead is signed +', M.formatGap(560), '+9:20');
    t.eq('a gap behind is signed −', M.formatGap(-40), '-0:40');
    t.eq('and pads its seconds', M.formatGap(65), '+1:05');

    t.eq('1st', M.ordinal(1), '1st');
    t.eq('2nd', M.ordinal(2), '2nd');
    t.eq('3rd', M.ordinal(3), '3rd');
    t.eq('4th', M.ordinal(4), '4th');
    t.eq('11th, not 11st', M.ordinal(11), '11th');
    t.eq('21st', M.ordinal(21), '21st');

    /* ------------------------------------------------------------------ */
    t.section('Easing helpers');

    t.eq('clamp holds the low end', M.clamp(-3, 0, 1), 0);
    t.eq('clamp holds the high end', M.clamp(9, 0, 1), 1);
    t.eq('lerp at 0 is the start', M.lerp(4, 10, 0), 4);
    t.eq('lerp at 1 is the end', M.lerp(4, 10, 1), 10);
    t.eq('lerp halfway is halfway', M.lerp(4, 10, 0.5), 7);

    /* approach is frame-rate independent: one step of 2/60s has to land in the
       same place as two steps of 1/60s. */
    const oneBigStep = M.approach(0, 1, 4, 2 / 60);
    let twoSmallSteps = M.approach(0, 1, 4, 1 / 60);
    twoSmallSteps = M.approach(twoSmallSteps, 1, 4, 1 / 60);
    t.near('easing is frame-rate independent', oneBigStep, twoSmallSteps, 1e-12);
    t.eq('a zero step does not move', M.approach(0.3, 1, 4, 0), 0.3);

    /* ------------------------------------------------------------------ */
    t.section('The pedal stroke');

    /* The honest test: solve, rebuild the limb from the angles, see where the
       foot ended up. Hip at (0, 1), pedal 0.5 forward and 0.6 down, which is
       comfortably inside a 0.45 + 0.46 limb. */
    const rebuild = (hx, hy, fx, fy, a, b, bend) => {
        const sol = M.ik2(hx, hy, fx, fy, a, b, bend);
        const kx = hx + Math.cos(sol.upper) * a;
        const ky = hy + Math.sin(sol.upper) * a;
        return { sol, knee: { x: kx, y: ky }, foot: { x: kx + Math.cos(sol.lower) * b, y: ky + Math.sin(sol.lower) * b } };
    };

    const reach = rebuild(0, 1, 0.5, 0.4, 0.45, 0.46, 1);
    t.near('the solved limb puts the foot on the pedal, in x', reach.foot.x, 0.5, 1e-9);
    t.near('and in y', reach.foot.y, 0.4, 1e-9);

    const other = rebuild(0, 1, 0.5, 0.4, 0.45, 0.46, -1);
    t.near('the other bend reaches the same pedal, in x', other.foot.x, 0.5, 1e-9);
    t.near('and in y', other.foot.y, 0.4, 1e-9);
    t.ok('but folds the knee to the other side', Math.abs(other.knee.y - reach.knee.y) > 0.1);

    /* Over-reach must not produce NaN — it clamps and points straight at the
       target, which is what a leg at full extension actually does. */
    const overReach = M.ik2(0, 1, 5, 1, 0.45, 0.46, 1);
    t.ok('an unreachable target still returns real angles',
        Number.isFinite(overReach.upper) && Number.isFinite(overReach.lower));
    t.near('and clamps the reach to just inside full extension', overReach.reach, 0.91, 0.001);
    t.near('with the limb pointing at the target', overReach.upper, 0, 0.02);

    const folded = M.ik2(0, 1, 0, 1, 0.45, 0.46, 1);
    t.ok('a target on top of the hip does not blow up',
        Number.isFinite(folded.upper) && Number.isFinite(folded.lower));

    /* A full crank revolution has to stay solvable at every angle, or the
       rider's foot leaves the pedal somewhere in the stroke. The hip is where
       poseBike puts it; if that moves, this is the test that will say so. */
    let allSolvable = true, worstError = 0;
    for (let i = 0; i < 72; i++) {
        const phase = (i / 72) * Math.PI * 2;
        const fx = -0.06 + Math.cos(phase) * 0.17;
        const fy = 0.32 + Math.sin(phase) * 0.17;
        const r = rebuild(-0.40, 0.95, fx, fy, 0.45, 0.46, 1);
        if (!Number.isFinite(r.sol.upper) || !Number.isFinite(r.sol.lower)) allSolvable = false;
        worstError = Math.max(worstError, Math.hypot(r.foot.x - fx, r.foot.y - fy));
    }
    t.ok('every crank angle solves', allSolvable);
    t.near('and the foot never leaves the pedal through a full revolution', worstError, 0, 1e-9);

    /* ------------------------------------------------------------------ */
    t.section('The seeded RNG');

    const rngA = M.makeRng(2024), rngB = M.makeRng(2024);
    t.eq('the same seed gives the same stream', rngA() === rngB(), true);
    let inRange = true;
    const rng = M.makeRng(5);
    for (let i = 0; i < 2000; i++) { const v = rng(); if (!(v >= 0 && v < 1)) inRange = false; }
    t.ok('and every value is in [0, 1)', inRange);

    const deck = [1, 2, 3, 4, 5, 6, 7, 8];
    const mixed = M.shuffled(deck, M.makeRng(11));
    t.eq('shuffling does not lose or invent items', mixed.slice().sort((a, b) => a - b).join(','), '1,2,3,4,5,6,7,8');
    t.eq('and leaves the original alone', deck.join(','), '1,2,3,4,5,6,7,8');
}
