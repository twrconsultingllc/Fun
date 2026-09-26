/* Full Circle Academy — renders index.html, course.html and lesson.html from
   window.ACADEMY (courses.js). Every piece of text goes in via textContent;
   the only markup set with innerHTML is static SVG (ACADEMY_ART and the play icon). */
(function () {
    'use strict';

    const data = window.ACADEMY;
    const ART = window.ACADEMY_ART || {};
    const page = document.body.dataset.page;
    const params = new URLSearchParams(location.search);

    /* ---------- tiny helpers ---------- */
    function el(tag, attrs, ...kids) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v == null || v === false) continue;
            if (k === 'class') node.className = v;
            else if (k === 'text') node.textContent = v;
            else if (k === 'style') node.style.cssText = v;
            else node.setAttribute(k, v === true ? '' : v);
        }
        for (const kid of kids.flat()) {
            if (kid == null || kid === false) continue;
            node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
        }
        return node;
    }
    function art(name) {
        const box = el('div', { class: 'art-box' });
        box.innerHTML = ART[name] || ART.pool || '';
        box.style.cssText = 'width:100%;height:100%';
        return box;
    }

    /* Progress lives only in this browser. Storage can throw (private mode,
       blocked site data), so every access is guarded. */
    const store = {
        get(key, fallback) {
            try { const v = localStorage.getItem('fca:' + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
        },
        set(key, value) {
            try { localStorage.setItem('fca:' + key, JSON.stringify(value)); } catch { /* ignore */ }
        },
        remove(key) {
            try { localStorage.removeItem('fca:' + key); } catch { /* ignore */ }
        }
    };
    const doneKey = (cid) => 'done:' + cid;
    const doneSet = (cid) => new Set(store.get(doneKey(cid), []));
    function courseProgress(course) {
        const done = doneSet(course.id);
        const n = course.lessons.filter((_, i) => done.has(i)).length;
        return { n, total: course.lessons.length, pct: Math.round((n / course.lessons.length) * 100) };
    }
    const sectionCount = (course) => course.lessons.reduce((a, l) => a + l.sections.length, 0);
    const totalMinutes = (course) => course.lessons.reduce((a, l) => a + (l.minutes || 0), 0);
    const videoCount = (course) => course.lessons.reduce((a, l) => a + l.sections.filter((s) => s.video).length, 0);

    function findCourse(id) { return data.courses.find((c) => c.id === id) || null; }
    const courseUrl = (c) => 'course.html?c=' + encodeURIComponent(c.id);
    const lessonUrl = (c, i) => 'lesson.html?c=' + encodeURIComponent(c.id) + '&l=' + (i + 1);

    function notFound(root, message) {
        root.replaceChildren(el('div', { class: 'wrap' },
            el('div', { class: 'notice' },
                el('h1', { text: 'Course not found' }),
                el('p', { text: message, style: 'color:var(--muted)' }),
                el('a', { class: 'btn btn-primary', href: 'index.html', text: 'Back to all courses' }))));
        document.title = 'Not found — Full Circle Academy';
    }

    /* ---------- YouTube ---------- */
    const ID_RE = /^[A-Za-z0-9_-]{11}$/;
    /* Accepts a bare ID or any of the usual link shapes: watch?v=, youtu.be/,
       /embed/, /shorts/, /live/, with or without www./m./-nocookie. */
    function parseYouTube(input) {
        const s = String(input || '').trim();
        if (ID_RE.test(s)) return s;
        let u;
        try { u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); } catch { return null; }
        const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
        let id = null;
        if (host === 'youtu.be') id = u.pathname.split('/')[1];
        else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
            if (u.pathname === '/watch') id = u.searchParams.get('v');
            else {
                const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([^/?#]+)/);
                if (m) id = m[2];
            }
        }
        return id && ID_RE.test(id) ? id : null;
    }
    function youtubeFrame(id, title) {
        return el('iframe', {
            src: 'https://www.youtube-nocookie.com/embed/' + id + '?rel=0&modestbranding=1',
            title: title || 'YouTube video',
            loading: 'lazy',
            allow: 'accelerometer; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen',
            allowfullscreen: true,
            referrerpolicy: 'strict-origin-when-cross-origin'
        });
    }

    /* A video slot: shows the ID from courses.js if there is one, otherwise
       whatever the user pasted in this browser, otherwise an empty slot with a
       paste box. */
    function videoSlot(video, key) {
        const wrap = el('div', { class: 'video' });
        const frame = el('div', { class: 'frame' });
        const bar = el('div', { class: 'video-bar' });
        wrap.append(frame, bar);

        function render() {
            const fixed = video.youtube && ID_RE.test(video.youtube) ? video.youtube : null;
            const pasted = fixed ? null : store.get('vid:' + key, null);
            const id = fixed || (pasted && ID_RE.test(pasted) ? pasted : null);
            frame.replaceChildren();
            bar.replaceChildren();
            frame.classList.toggle('empty', !id);

            if (id) {
                frame.append(youtubeFrame(id, video.title));
                bar.append(el('small', { text: video.title || '' }));
                if (!fixed) {
                    const change = el('button', { type: 'button', class: 'linkbtn', text: 'Change video' });
                    change.addEventListener('click', () => { store.remove('vid:' + key); render(); });
                    bar.append(el('small', {},
                        'Preview only (this browser). To keep it, set ',
                        el('code', { text: "youtube: '" + id + "'" }),
                        ' in courses.js ',
                        change));
                }
                return;
            }

            const inputId = 'yt-' + key.replace(/[^a-z0-9]/gi, '-');
            const input = el('input', { id: inputId, type: 'url', inputmode: 'url', autocomplete: 'off', spellcheck: 'false', placeholder: 'https://www.youtube.com/watch?v=…' });
            const err = el('div', { class: 'video-err', role: 'status', 'aria-live': 'polite' });
            const form = el('form', { class: 'video-form', novalidate: true },
                el('label', { class: 'sr-only', for: inputId, text: 'YouTube link for ' + (video.title || 'this video') }),
                input,
                el('button', { type: 'submit', class: 'btn btn-primary', text: 'Embed' }));
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const id = parseYouTube(input.value);
                if (!id) {
                    input.classList.add('bad');
                    err.textContent = 'That doesn’t look like a YouTube link. Try a watch?v=, youtu.be or shorts link.';
                    input.focus();
                    return;
                }
                store.set('vid:' + key, id);
                render();
            });
            input.addEventListener('input', () => { input.classList.remove('bad'); err.textContent = ''; });

            const play = el('div', { class: 'play' });
            play.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="#64B5F6"/></svg>';
            frame.append(el('div', { class: 'video-empty' },
                play,
                el('strong', { text: video.title || 'Video' }),
                el('small', { text: 'No video yet. Paste a YouTube link to embed it here.' }),
                form,
                err));
        }
        render();
        return wrap;
    }

    /* ---------- landing ---------- */
    function renderLanding() {
        const grid = document.getElementById('courseGrid');
        let lessons = 0, videos = 0;
        for (const c of data.courses) {
            lessons += c.lessons.length;
            videos += videoCount(c);
            const p = courseProgress(c);
            const artBox = el('div', { class: 'card-art' }, art(c.art), el('span', { class: 'tag', text: c.name }));
            grid.append(el('a', { class: 'card', href: courseUrl(c), style: '--c:' + c.color },
                artBox,
                el('div', { class: 'card-body' },
                    el('h3', { text: c.name }),
                    el('p', { text: c.blurb }),
                    el('div', { class: 'card-meta' },
                        el('span', { class: 'chip', text: c.lessons.length + ' lessons' }),
                        el('span', { class: 'chip', text: totalMinutes(c) + ' min' }),
                        el('span', { class: 'chip', text: c.level })),
                    el('div', { class: 'progress', role: 'progressbar', 'aria-label': c.name + ' progress', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': p.pct },
                        el('i', { style: 'width:' + p.pct + '%' })),
                    el('div', { class: 'card-go' },
                        el('span', { text: p.n ? 'Continue · ' + p.n + '/' + p.total : 'Start course' }),
                        el('span', { 'aria-hidden': 'true', text: '→' })))));
        }
        const featured = document.getElementById('featuredVideo');
        if (featured && data.featured) featured.append(videoSlot(data.featured, 'featured'));
        else if (featured) featured.closest('section').hidden = true;
        document.getElementById('statCourses').textContent = data.courses.length;
        document.getElementById('statLessons').textContent = lessons;
        document.getElementById('statVideos').textContent = videos;
    }

    /* ---------- course overview ---------- */
    function renderCourse() {
        const root = document.getElementById('app');
        const course = findCourse(params.get('c') || 'swim');
        if (!course) return notFound(root, 'There’s no course called “' + params.get('c') + '”.');
        document.title = course.name + ' — Full Circle Academy';
        const done = doneSet(course.id);
        const p = courseProgress(course);
        const next = course.lessons.findIndex((_, i) => !done.has(i));
        const startAt = next === -1 ? 0 : next;

        const hero = el('section', { class: 'course-hero', style: '--c:' + course.color },
            el('div', { class: 'wrap' },
                el('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' },
                    el('a', { href: 'index.html', text: 'Courses' }), el('span', { 'aria-hidden': 'true', text: '/' }), el('span', { text: course.name })),
                el('div', { class: 'row' },
                    el('div', {},
                        el('div', { class: 'eyebrow', text: 'Course · ' + course.level }),
                        el('h1', {}, el('span', { text: course.name }), ' Fundamentals'),
                        el('p', { text: course.blurb }),
                        el('div', { class: 'card-meta' },
                            el('span', { class: 'chip', text: course.lessons.length + ' lessons' }),
                            el('span', { class: 'chip', text: sectionCount(course) + ' sections' }),
                            el('span', { class: 'chip', text: videoCount(course) + ' videos' }),
                            el('span', { class: 'chip', text: '~' + totalMinutes(course) + ' min' })),
                        el('div', { class: 'progress-row' },
                            el('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Course progress', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': p.pct },
                                el('i', { style: 'width:' + p.pct + '%;background:' + course.color })),
                            el('span', { text: p.n + ' of ' + p.total + ' complete' })),
                        el('div', { class: 'hero-actions', style: 'margin-top:22px' },
                            el('a', { class: 'btn btn-primary', href: lessonUrl(course, startAt), text: p.n ? 'Continue: Lesson ' + (startAt + 1) : 'Start Lesson 1' }))),
                    el('div', { class: 'art' }, art(course.art)))));

        const list = el('div', { class: 'lessons' });
        course.lessons.forEach((l, i) => {
            list.append(el('a', { class: 'lesson-row' + (done.has(i) ? ' done' : ''), href: lessonUrl(course, i), style: '--c:' + course.color },
                el('div', { class: 'lesson-num', text: done.has(i) ? '✓' : String(i + 1), 'aria-hidden': 'true' }),
                el('div', {},
                    el('h3', { text: 'Lesson ' + (i + 1) + ': ' + l.title }),
                    el('p', { text: l.summary }),
                    el('div', { class: 'sections' },
                        el('span', { class: 'chip', text: l.sections.length + (l.sections.length === 1 ? ' section' : ' sections') }),
                        el('span', { class: 'chip', text: (l.minutes || 0) + ' min' }),
                        l.sections.some((s) => s.video) ? el('span', { class: 'chip', text: '▶ video' }) : null,
                        done.has(i) ? el('span', { class: 'chip', text: 'Completed', style: 'color:var(--green-light)' }) : null)),
                el('span', { class: 'go', text: done.has(i) ? 'Review →' : 'Open →' })));
        });

        root.replaceChildren(hero, el('section', { class: 'section' },
            el('div', { class: 'wrap' },
                el('div', { class: 'section-head' },
                    el('div', {}, el('div', { class: 'eyebrow', text: 'Syllabus' }), el('h2', { text: 'Lessons' })),
                    el('p', { text: 'Each lesson has short sections of reading, pictures and video. Work through them in order or jump in anywhere.' })),
                list)));
    }

    /* ---------- lesson ---------- */
    function renderLesson() {
        const root = document.getElementById('app');
        const course = findCourse(params.get('c') || 'swim');
        if (!course) return notFound(root, 'There’s no course called “' + params.get('c') + '”.');
        let li = parseInt(params.get('l') || '1', 10) - 1;
        if (!(li >= 0 && li < course.lessons.length)) li = 0;
        const lesson = course.lessons[li];
        document.title = lesson.title + ' — ' + course.name + ' — Full Circle Academy';
        const done = doneSet(course.id);

        /* sidebar */
        const lessonList = el('ul', { class: 'side-list', style: '--c:' + course.color });
        course.lessons.forEach((l, i) => lessonList.append(el('li', {},
            el('a', { href: lessonUrl(course, i), 'aria-current': i === li ? 'page' : null },
                el('span', { class: 'n', text: String(i + 1) }), el('span', { text: l.title }),
                done.has(i) ? el('span', { class: 'check', 'aria-label': 'completed', text: '✓' }) : null))));
        const toc = el('ul', { class: 'side-list', style: '--c:' + course.color });
        lesson.sections.forEach((s, i) => toc.append(el('li', {},
            el('a', { href: '#s' + (i + 1) }, el('span', { class: 'n', text: (li + 1) + '.' + (i + 1) }), el('span', { text: s.heading })))));
        const sidebar = el('aside', { class: 'sidebar' },
            el('div', {}, el('h4', { text: course.name + ' lessons' }), lessonList),
            el('div', { class: 'toc' }, el('h4', { text: 'In this lesson' }), toc));

        /* content */
        const main = el('article', { style: '--c:' + course.color });
        main.append(el('div', { class: 'lesson-head', style: '--c:' + course.color },
            el('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' },
                el('a', { href: 'index.html', text: 'Courses' }), el('span', { 'aria-hidden': 'true', text: '/' }),
                el('a', { href: courseUrl(course), text: course.name }), el('span', { 'aria-hidden': 'true', text: '/' }),
                el('span', { text: 'Lesson ' + (li + 1) })),
            el('div', { class: 'eyebrow', text: course.name + ' · Lesson ' + (li + 1) + ' of ' + course.lessons.length, style: 'margin-top:16px;color:' + course.color }),
            el('h1', { text: lesson.title }),
            el('p', { class: 'intro', text: lesson.summary }),
            el('div', { class: 'meta' },
                el('span', { class: 'chip', text: lesson.sections.length + (lesson.sections.length === 1 ? ' section' : ' sections') }),
                el('span', { class: 'chip', text: (lesson.minutes || 0) + ' min' }))));

        lesson.sections.forEach((s, i) => {
            const sec = el('section', { class: 'lesson-section', id: 's' + (i + 1) },
                el('h2', {}, el('span', { class: 'n', text: (li + 1) + '.' + (i + 1) }), el('span', { text: s.heading })));
            for (const t of s.text || []) sec.append(el('p', { text: t }));
            if (s.bullets) sec.append(el('ul', {}, s.bullets.map((b) => el('li', { text: b }))));
            if (s.image) {
                const frame = el('div', { class: 'frame' });
                if (s.image.src) frame.append(el('img', { src: s.image.src, alt: s.image.alt || '', loading: 'lazy' }));
                else frame.append(art(s.image.art));
                sec.append(el('figure', {}, frame, s.image.caption ? el('figcaption', { text: s.image.caption }) : null));
            }
            if (s.tip) sec.append(el('div', { class: 'callout' }, el('b', { text: 'Coach’s tip' }), el('p', { text: s.tip })));
            if (s.video) sec.append(videoSlot(s.video, course.id + '-' + (li + 1) + '-' + (i + 1)));
            main.append(sec);
        });

        /* footer: prev / complete / next */
        const doneBtn = el('button', { type: 'button', class: 'btn btn-ghost done-btn', 'aria-pressed': String(done.has(li)) });
        const paintDone = () => { const on = doneSet(course.id).has(li); doneBtn.setAttribute('aria-pressed', String(on)); doneBtn.textContent = on ? '✓ Completed' : 'Mark complete'; };
        doneBtn.addEventListener('click', () => {
            const set = doneSet(course.id);
            if (set.has(li)) set.delete(li); else set.add(li);
            store.set(doneKey(course.id), [...set]);
            paintDone();
            const check = lessonList.children[li].querySelector('.check');
            if (set.has(li) && !check) lessonList.children[li].firstChild.append(el('span', { class: 'check', 'aria-label': 'completed', text: '✓' }));
            if (!set.has(li) && check) check.remove();
        });
        paintDone();
        const prev = li > 0 ? el('a', { class: 'btn btn-ghost', href: lessonUrl(course, li - 1), text: '← Lesson ' + li }) : el('a', { class: 'btn btn-ghost', href: courseUrl(course), text: '← Course overview' });
        const next = li < course.lessons.length - 1 ? el('a', { class: 'btn btn-primary', href: lessonUrl(course, li + 1), text: 'Lesson ' + (li + 2) + ' →' }) : el('a', { class: 'btn btn-primary', href: 'index.html', text: 'All courses →' });
        main.append(el('div', { class: 'lesson-foot' }, prev, doneBtn, next));

        root.replaceChildren(el('div', { class: 'wrap lesson-layout' }, sidebar, main));
    }

    /* Highlight the current course in the header nav. */
    const current = params.get('c') || (page === 'landing' ? null : 'swim');
    for (const a of document.querySelectorAll('.nav a')) {
        const m = (a.getAttribute('href') || '').match(/\?c=([a-z]+)/);
        if (m && m[1] === current) a.setAttribute('aria-current', 'page');
    }

    if (page === 'landing') renderLanding();
    else if (page === 'course') renderCourse();
    else if (page === 'lesson') renderLesson();

    /* test hook — nothing on the page reads it */
    window.__academy = { parseYouTube };
})();
