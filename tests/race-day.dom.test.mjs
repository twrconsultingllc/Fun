/* race-day.html — the page itself, driven in jsdom.
 *
 * jsdom has no WebGL and never fetches the three.js CDN, which is exactly the
 * case this page is built to survive: with no renderer the quiz still has to
 * run, start to finish, and say on screen why there is no race to look at.
 * That is the same rule the rest of this repo follows — render what you can,
 * and make the failure visible — so it is pinned here rather than assumed.
 *
 * Everything below drives the page the way a person does: press start, click
 * an option or press a number key, and read what the HUD says afterwards. The
 * page exposes `window.__raceday` so the suite can step the countdown between
 * questions instead of sleeping through it; nothing on the page reads it.
 */

import { openDom } from './lib/page.mjs';

export const name = 'Race Day — page behaviour';

/* Opened through the shared helper so the window is tracked and closed. This
   page runs a self-scheduling requestAnimationFrame loop, which keeps jsdom's
   frame timer — and therefore the whole Node process — alive until it is. */
const open = (html, url) => openDom(html, url);

export default async function run(t, page) {
    let env;
    try {
        env = await open(page.html, page.url);
    } catch (error) {
        t.ok('the page opens in jsdom', false);
        t.note(error.message);
        return;
    }

    const { window, document, errors } = env;
    const $ = (id) => document.getElementById(id);
    const text = (id) => ($(id) ? $(id).textContent.trim() : `<missing #${id}>`);
    const options = () => Array.from(document.querySelectorAll('#q-opts .opt'));
    const press = (k) => window.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

    try {
        /* -------------------------------------------------------------- */
        t.section('Booting with no WebGL');

        t.eq('the page script ran without throwing', errors.length, 0);
        if (errors.length) t.note(errors.join('\n       '));

        const api = window.__raceday;
        t.ok('the page exposes its test hooks', !!api);
        if (!api) return;

        t.eq('the loading card is dismissed', $('boot').className, 'gone');
        t.eq('and the page says why there is no 3D', $('nowebgl').className, 'show');
        t.eq('the camera control is hidden, since there is no camera', $('cam-pill').style.display, 'none');
        t.eq('the start card is up', $('start-screen').className.includes('show'), true);
        t.eq('and the results card is not', $('finish-screen').className.includes('show'), false);

        /* -------------------------------------------------------------- */
        t.section('The HUD before the gun');

        t.eq('the progress rail has a segment per leg', document.querySelectorAll('#rail .seg').length, 5);
        t.eq('labelled in race order',
            Array.from(document.querySelectorAll('#rail .lbl')).map((n) => n.textContent).join(','),
            'Swim,T1,Bike,T2,Run');
        t.eq('the leg banner starts on the swim', text('stage-name'), 'Swim');
        t.eq('with the leg described', text('stage-detail'), '1.5 km — Biscayne Bay');
        t.eq('the clock is at zero', text('clock'), '0:00:00');
        t.eq('and nothing has been answered', text('score'), '0/20');
        t.eq('the brand mark is on the page', document.querySelectorAll('.brand').length >= 2, true);

        /* -------------------------------------------------------------- */
        t.section('Starting a race');

        api.startRace(5);
        t.eq('the start card goes away', $('start-screen').className.includes('show'), false);
        t.eq('the question card waits a beat first', $('quiz').className.includes('show'), false);

        api.step();
        t.eq('then the question card appears', $('quiz').className.includes('show'), true);
        t.eq('the leg chip says which leg', text('q-chip'), 'Swim');
        t.eq('the counter starts at one of four', text('q-count'), '1 / 4');
        t.eq('four options are offered', options().length, 4);
        t.eq('numbered for the keyboard',
            options().map((b) => b.querySelector('.key').textContent).join(''), '1234');
        t.ok('the question has some text', text('q-text').length > 20);
        t.eq('no explanation is showing yet', $('q-why').className.includes('show'), false);

        /* -------------------------------------------------------------- */
        t.section('Getting one right');

        const right = api.race.questions.swim[0].a;
        options()[right].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

        t.eq('the chosen option is marked correct', options()[right].className.includes('right'), true);
        t.eq('every option is now locked', options().every((b) => b.disabled), true);
        t.eq('the explanation appears', $('q-why').className.includes('show'), true);
        t.eq('styled as a good answer', $('q-why').className.includes('good'), true);
        t.ok('and it says why', text('q-why').length > 60);
        t.eq('the score went up', text('score'), '1/20');
        /* 1980 × 0.25 − 90 = 405 */
        t.eq('the race clock took the bonus off the leg', api.helpers.raceElapsed(api.race), 405);
        t.eq('the rail filled a quarter of the swim',
            document.querySelector('#rail .seg .fill').style.width, '25%');

        t.eq('answering twice does nothing', api.submitAnswer(0), undefined);
        t.eq('the score is unchanged', text('score'), '1/20');

        /* -------------------------------------------------------------- */
        t.section('Getting one wrong');

        api.step();
        t.eq('the next question is up', text('q-count'), '2 / 4');
        const answer = api.race.questions.swim[1].a;
        const guess = answer === 0 ? 1 : 0;
        options()[guess].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

        t.eq('the guess is marked wrong', options()[guess].className.includes('wrong'), true);
        t.eq('and the right one is shown anyway', options()[answer].className.includes('right'), true);
        t.eq('the explanation is styled as a miss', $('q-why').className.includes('bad'), true);
        t.ok('and leads with the answer that was right',
            text('q-why').includes(api.race.questions.swim[1].opts[answer].slice(0, 30)));
        t.eq('the score did not move', text('score'), '1/20');
        /* 1980 × 0.5 − 90 + 60 = 960 */
        t.eq('and the penalty went on the clock', api.helpers.raceElapsed(api.race), 960);
        t.eq('the miss is kept for the recap', api.race.missed.length, 1);
        t.eq('tagged with its leg', api.race.missed[0].stage, 'Swim');

        /* -------------------------------------------------------------- */
        t.section('The keyboard');

        api.step();
        t.eq('question three is up', text('q-count'), '3 / 4');
        const third = api.race.questions.swim[2].a;
        press(String(third + 1));
        t.eq('a number key answers the question', options()[third].className.includes('right'), true);
        t.eq('and the score counts it', text('score'), '2/20');

        press('5');
        t.eq('a key with no option behind it is ignored', text('score'), '2/20');

        /* -------------------------------------------------------------- */
        t.section('Crossing into the next leg');

        api.step();
        t.eq('question four is up', text('q-count'), '4 / 4');
        api.answerCorrectly();
        api.step();
        t.eq('the leg banner moved to T1', text('stage-name'), 'T1');
        t.eq('with its own description', text('stage-detail'), 'Transition — swim to bike');
        t.eq('the swim segment is full',
            document.querySelector('#rail .seg .fill').style.width, '100%');
        t.eq('and marked done', document.querySelectorAll('#rail .seg')[0].className.includes('done'), true);
        /* 1980 − 3×90 + 60 = 1770 */
        t.eq('the swim split was written down', api.race.legs[0].time, 1770);

        api.step();
        t.eq('the T1 questions are labelled as a drill', text('q-label'), 'Transition drill');
        t.eq('and the chip follows the leg', text('q-chip'), 'T1');

        /* -------------------------------------------------------------- */
        t.section('A race won');

        api.startRace(5);
        const won = api.playThrough([]);
        t.eq('twenty questions, twenty right', won.score.right, 20);
        t.eq('the race is finished', api.race.finished, true);
        t.eq('the clock reads the perfect time', won.time, 8540);
        t.eq('and it is first place', won.place, 1);

        api.showFinishScreen();
        t.eq('the results card comes up', $('finish-screen').className.includes('show'), true);
        t.eq('with the placing spelled out', text('finish-place'), '1st Place');
        t.eq('the finish time', text('stat-time'), '2:22:20');
        t.eq('the score', text('stat-score'), '20/20');
        t.eq('and the gap to the next athlete', text('stat-gap'), '+9:20');
        t.eq('a gold medal', text('medal'), '🥇');
        t.eq('the subtitle says you won', text('finish-sub'), 'Miami · you won the race');
        t.eq('every leg has a split row', document.querySelectorAll('#split-list .split-row').length, 5);
        t.eq('the swim split is the perfect one',
            document.querySelectorAll('#split-list .split-row')[0].querySelector('.tm').textContent, '0:27:00');
        t.eq('the bike split too',
            document.querySelectorAll('#split-list .split-row')[2].querySelector('.tm').textContent, '1:06:00');
        t.ok('and a clean sheet is called out', text('missed').includes('clean sheet'));

        /* -------------------------------------------------------------- */
        t.section('A race lost');

        api.startRace(5);
        const lost = api.playThrough([0, 1, 2, 3, 4]);
        t.eq('five mistakes is fifteen out of twenty', lost.score.right, 15);
        t.eq('which is no longer good enough to win', lost.place, 2);
        t.eq('the gap is now the wrong way round', lost.gap < 0, true);

        api.showFinishScreen();
        t.eq('the card shows second', text('finish-place'), '2nd Place');
        t.eq('with a silver medal', text('medal'), '🥈');
        t.eq('the subtitle drops the win', text('finish-sub'), 'Miami · 2nd on the day');
        t.eq('every miss is on the recap', document.querySelectorAll('#missed .item').length, 5);
        t.ok('and each one names what the answer should have been',
            Array.from(document.querySelectorAll('#missed .item')).every((n) => n.querySelector('b')));

        /* -------------------------------------------------------------- */
        t.section('Between the podium and the paperwork');

        $('podium-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        t.eq('the card can be put away to watch the ceremony',
            $('finish-screen').className.includes('show'), false);
        const tab = $('results-tab');
        t.ok('leaving a way back to it', !!tab);
        tab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        t.eq('which brings the results back', $('finish-screen').className.includes('show'), true);
        t.eq('and puts itself away', tab.style.display, 'none');

        $('again-btn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        t.eq('racing again clears the results', $('finish-screen').className.includes('show'), false);
        t.eq('and resets the score', text('score'), '0/20');
        t.eq('back to the swim', text('stage-name'), 'Swim');
        t.eq('with an unfinished race', api.race.finished, false);

        /* -------------------------------------------------------------- */
        t.section('The camera control');

        t.eq('it starts on the close shot', $('cam-close').className, 'on');
        $('cam-wide').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        t.eq('clicking wide switches to it', $('cam-wide').className, 'on');
        t.eq('and drops the close one', $('cam-close').className, '');
        t.eq('choosing by hand stops the automatic cuts', api.game.camAuto, false);
        press('c');
        t.eq('the C key toggles back', $('cam-close').className, 'on');
        press('C');
        t.eq('and forward again, in either case', $('cam-wide').className, 'on');

        /* -------------------------------------------------------------- */
        t.section('What the markup and the script agree on');

        /* Every leg the script knows about needs its colour in the rail, and
           every id the script looks up needs to exist in the markup. */
        const ids = ['scene', 'boot', 'nowebgl', 'stage-name', 'stage-detail', 'clock', 'place', 'score',
            'rail', 'quiz', 'q-chip', 'q-label', 'q-count', 'q-text', 'q-opts', 'q-why', 'verdict',
            'cam-pill', 'cam-close', 'cam-wide', 'start-screen', 'start-btn', 'finish-screen',
            'again-btn', 'podium-btn', 'medal', 'finish-place', 'finish-sub', 'stat-time', 'stat-score',
            'stat-gap', 'split-list', 'missed'];
        const missing = ids.filter((id) => !$(id));
        t.eq('every element the script reaches for is in the markup', missing.join(',') || 'none', 'none');

        t.eq('the page is a single file — no local scripts or styles',
            document.querySelectorAll('script[src]:not([src^="http"]), link[rel=stylesheet]:not([href^="http"])').length, 0);
        t.ok('three.js is loaded from the same CDN as the rest of the repo',
            page.html.includes('cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'));
        t.ok('the Full Circle mark is inline SVG, not an image file',
            page.html.includes('<path d="M 50 2 A 48 48 0 0 1 50 98'));
        t.ok('the favicon carries the mark too', page.html.includes('rel="icon"'));
        t.eq('the page still has no errors after all of that', errors.length, 0);
        if (errors.length) t.note(errors.join('\n       '));
    } finally {
        window.close();
    }
}
