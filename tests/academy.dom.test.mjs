/* academy/ — the Full Circle Academy mockup (landing → course → lesson).
 *
 * The three pages share two same-origin scripts (courses.js, academy.js)
 * instead of inline ones, so their CSP can be `script-src 'self'`. jsdom only
 * fetches external scripts with `resources: 'usable'`, which would also try to
 * pull the Google Fonts stylesheet, so this suite reads the two scripts itself
 * (from disk or from the deployed URL, whichever `page.url` points at) and
 * runs each page with them inlined in place of the <script src> tags. The
 * pages' own HTML is otherwise untouched, and course/lesson are opened with
 * real query strings so the routing is exercised as a visitor would hit it.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { requireJsdom } from './lib/page.mjs';

export const name = 'Full Circle Academy — landing, course, lesson';

async function fetchText(url) {
    if (url.startsWith('file:')) return readFile(fileURLToPath(url), 'utf8');
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} returned HTTP ${r.status}`);
    return r.text();
}

export default async function run(t, page) {
    const { JSDOM, VirtualConsole } = await requireJsdom();
    const base = new URL('./', page.url).href;
    const [coursesJs, academyJs, courseHtml, lessonHtml] = await Promise.all(
        ['courses.js', 'academy.js', 'course.html', 'lesson.html'].map((f) => fetchText(base + f)));
    const inline = (html) => html
        .replace('<script src="courses.js"></script>', () => `<script>${coursesJs}</script>`)
        .replace('<script src="academy.js"></script>', () => `<script>${academyJs}</script>`);

    const opened = [];
    async function open(html, query = '', seed = null) {
        const errors = [];
        const vc = new VirtualConsole();
        vc.on('jsdomError', (e) => errors.push(e.message));
        const file = html === courseHtml ? 'course.html' : html === lessonHtml ? 'lesson.html' : 'index.html';
        const dom = new JSDOM(inline(html), {
            url: 'https://academy.test/academy/' + file + query,
            runScripts: 'dangerously',
            virtualConsole: vc,
            beforeParse(w) { if (seed) for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, v); }
        });
        opened.push(dom.window);
        return { window: dom.window, document: dom.window.document, errors };
    }

    try {
        t.section('Markup and policy');
        for (const [label, html] of [['index.html', page.html], ['course.html', courseHtml], ['lesson.html', lessonHtml]]) {
            const csp = (html.match(/Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
            t.ok(`${label}: CSP allows scripts only from 'self'`, /script-src 'self';/.test(csp));
            t.ok(`${label}: CSP frames only youtube-nocookie`, /frame-src https:\/\/www\.youtube-nocookie\.com;/.test(csp));
            t.ok(`${label}: no inline <script> bodies`, !/<script>(?!<\/script>)/.test(html) && !/<script(?![^>]*\bsrc=)[^>]*>/.test(html));
            t.ok(`${label}: no inline event handlers`, !/\son[a-z]+\s*=/.test(html));
            t.ok(`${label}: no inline style attributes (blocked by the CSP)`, !/\sstyle="/.test(html));
            t.ok(`${label}: has a description meta`, /<meta name="description" content="[^"]{20,}"/.test(html));
        }

        t.section('Landing page');
        const land = await open(page.html);
        t.eq('landing: scripts ran without errors', land.errors.length, 0);
        if (land.errors.length) t.note(land.errors.join('\n       '));
        const courses = land.window.ACADEMY.courses;
        const cards = land.document.querySelectorAll('#courseGrid .card');
        t.eq('one card per course', cards.length, courses.length);
        t.eq('first card links to the swim course', cards[0].getAttribute('href'), 'course.html?c=swim');
        t.eq('lesson stat matches the data', land.document.getElementById('statLessons').textContent,
            courses.reduce((a, c) => a + c.lessons.length, 0));
        t.ok('every course id is unique', new Set(courses.map((c) => c.id)).size === courses.length);
        t.ok('every course art exists', courses.every((c) => land.window.ACADEMY_ART[c.art]));
        t.ok('every section has a heading', courses.every((c) => c.lessons.every((l) => l.sections.every((s) => s.heading))));

        t.section('YouTube link parsing');
        const parse = land.window.__academy.parseYouTube;
        const id = 'dQw4w9WgXcQ';
        for (const input of [
            id,
            'https://www.youtube.com/watch?v=' + id,
            'https://www.youtube.com/watch?v=' + id + '&t=42s&list=PL123',
            'youtube.com/watch?v=' + id,
            'https://m.youtube.com/watch?v=' + id,
            'https://youtu.be/' + id + '?si=abc',
            'https://www.youtube.com/shorts/' + id,
            'https://www.youtube.com/embed/' + id,
            'https://www.youtube.com/live/' + id,
            'https://www.youtube-nocookie.com/embed/' + id,
            '  https://youtu.be/' + id + '  '
        ]) t.eq(`parses ${input.trim()}`, parse(input), id);
        for (const input of ['', 'hello', 'https://vimeo.com/123456789', 'https://evil.example/watch?v=' + id,
            'https://youtube.com.evil.example/watch?v=' + id, 'https://www.youtube.com/watch?v=short',
            'javascript:alert(1)', 'https://www.youtube.com/watch?v=' + id + '"><img>']) {
            t.eq(`rejects ${JSON.stringify(input)}`, parse(input), null);
        }

        t.section('Course page');
        const course = await open(courseHtml, '?c=swim');
        t.eq('course: scripts ran without errors', course.errors.length, 0);
        const swim = courses.find((c) => c.id === 'swim');
        const rows = course.document.querySelectorAll('.lesson-row');
        t.eq('one row per swim lesson', rows.length, swim.lessons.length);
        t.eq('first row opens lesson 1', rows[0].getAttribute('href'), 'lesson.html?c=swim&l=1');
        t.ok('title names the course', course.document.title.startsWith('Swim'));
        const bogus = await open(courseHtml, '?c=%3Cimg%20src%3Dx%3E');
        t.ok('unknown course shows a not-found notice', !!bogus.document.querySelector('.notice'));
        t.eq('unknown course id is shown as text, not markup', bogus.document.querySelectorAll('img').length, 0);

        t.section('Lesson page');
        const lesson = await open(lessonHtml, '?c=swim&l=1');
        t.eq('lesson: scripts ran without errors', lesson.errors.length, 0);
        const secs = lesson.document.querySelectorAll('.lesson-section');
        t.eq('one block per section', secs.length, swim.lessons[0].sections.length);
        t.ok('has a picture', !!lesson.document.querySelector('figure svg'));
        t.ok('has a coach’s tip', !!lesson.document.querySelector('.callout'));
        const form = lesson.document.querySelector('.video-form');
        t.ok('empty video slot offers a paste box', !!form);
        const input = form.querySelector('input');
        t.ok('paste box has a label', !!lesson.document.querySelector(`label[for="${input.id}"]`));

        input.value = 'not a link';
        form.dispatchEvent(new lesson.window.Event('submit', { bubbles: true, cancelable: true }));
        t.eq('a bad link does not embed anything', lesson.document.querySelectorAll('iframe').length, 0);
        t.ok('a bad link explains why', /YouTube link/.test(lesson.document.querySelector('.video-err').textContent));

        input.value = 'https://youtu.be/' + id;
        form.dispatchEvent(new lesson.window.Event('submit', { bubbles: true, cancelable: true }));
        const frame = lesson.document.querySelector('iframe');
        t.ok('a good link embeds a player', !!frame);
        t.eq('player uses youtube-nocookie', frame && frame.getAttribute('src'), `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`);
        t.eq('player sends a referrer YouTube accepts', frame && frame.getAttribute('referrerpolicy'), 'strict-origin-when-cross-origin');
        t.eq('pasted ID is remembered', lesson.window.localStorage.getItem('fca:vid:swim-1-3'), JSON.stringify(id));
        t.ok('bar shows the courses.js line to make it permanent', lesson.document.querySelector('.video-bar code').textContent === `youtube: '${id}'`);

        const again = await open(lessonHtml, '?c=swim&l=1', { 'fca:vid:swim-1-3': JSON.stringify(id) });
        t.ok('a remembered video embeds on reload', !!again.document.querySelector('iframe'));
        const tampered = await open(lessonHtml, '?c=swim&l=1', { 'fca:vid:swim-1-3': JSON.stringify('x"><script>') });
        t.eq('a tampered stored value is ignored', tampered.document.querySelectorAll('iframe').length, 0);

        const doneBtn = lesson.document.querySelector('.done-btn');
        doneBtn.click();
        t.eq('mark complete toggles on', doneBtn.getAttribute('aria-pressed'), 'true');
        t.eq('completion is stored', lesson.window.localStorage.getItem('fca:done:swim'), '[0]');

        const outOfRange = await open(lessonHtml, '?c=swim&l=99');
        t.ok('an out-of-range lesson falls back to lesson 1', outOfRange.document.querySelector('.lesson-head h1').textContent === swim.lessons[0].title);
        const last = await open(lessonHtml, '?c=swim&l=' + swim.lessons.length);
        t.eq('last lesson’s next button goes back to all courses', last.document.querySelector('.lesson-foot .btn-primary').getAttribute('href'), 'index.html');
    } finally {
        for (const w of opened) { try { w.close(); } catch { /* gone */ } }
    }
}
