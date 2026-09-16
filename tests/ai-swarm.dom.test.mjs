/* ai-swarm.html — the page itself, driven in jsdom.
 *
 * jsdom has no WebGL and never fetches the three.js CDN, so this suite runs the
 * page twice. Once bare, to pin the behaviour when the CDN is unreachable: the
 * page must say so on screen rather than fail silently — that is the rule the
 * "Render the mark without WebGL, and make failures visible" commit set for
 * this repo. Then again against a small three.js stub, which lets every line of
 * the interaction layer — filters, search, the timeline, the detail panel —
 * execute for real.
 */

import { requireJsdom } from './lib/page.mjs';

export const name = 'AI Swarm — page behaviour';

/* --------------------------------------------------------------------------
   A three.js stand-in. It implements only what ai-swarm.html actually calls,
   and it deliberately draws nothing — the point is to exercise the page's own
   logic, not three's.
-------------------------------------------------------------------------- */
function makeThreeStub() {
    class Vec3 {
        constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
        set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
        setScalar(s) { return this.set(s, s, s); }
        copy(v) { return this.set(v.x, v.y, v.z); }
        clone() { return new Vec3(this.x, this.y, this.z); }
        lerp(v, a) { this.x += (v.x - this.x) * a; this.y += (v.y - this.y) * a; this.z += (v.z - this.z) * a; return this; }
        addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
        multiplyScalar(s) { return this.set(this.x * s, this.y * s, this.z * s); }
        setFromMatrixColumn() { return this.set(1, 0, 0); }
        project() { return this.set(this.x / 200, this.y / 200, 0.5); }
    }

    class Obj3 {
        constructor() {
            this.position = new Vec3();
            this.scale = new Vec3(1, 1, 1);
            this.rotation = { x: 0, y: 0, z: 0 };
            this.matrix = {};
            this.visible = true;
            this.userData = {};
            this.children = [];
        }
        add(child) { this.children.push(child); return this; }
        lookAt() {}
        updateMatrix() {}
        updateProjectionMatrix() {}
    }

    class Color {
        constructor(hex) {
            const n = parseInt(String(hex).replace('#', ''), 16) || 0;
            this.r = ((n >> 16) & 255) / 255;
            this.g = ((n >> 8) & 255) / 255;
            this.b = (n & 255) / 255;
        }
        clone() { const c = new Color('#000000'); c.r = this.r; c.g = this.g; c.b = this.b; return c; }
        lerp(o, a) { this.r += (o.r - this.r) * a; this.g += (o.g - this.g) * a; this.b += (o.b - this.b) * a; return this; }
    }

    class BufferGeometry {
        constructor() { this.attributes = {}; this.drawRange = { start: 0, count: Infinity }; }
        setAttribute(name, attr) { this.attributes[name] = attr; return this; }
        setDrawRange(start, count) { this.drawRange = { start, count }; }
    }

    const material = function (opts) { Object.assign(this, opts || {}); };

    return {
        Vector3: Vec3,
        Color,
        BufferGeometry,
        BufferAttribute: function (array, itemSize) { this.array = array; this.itemSize = itemSize; this.needsUpdate = false; },
        SphereGeometry: function () {},
        Texture: function () { this.needsUpdate = false; },
        FogExp2: function (c, d) { this.color = c; this.density = d; },
        MeshBasicMaterial: material,
        SpriteMaterial: material,
        PointsMaterial: material,
        LineBasicMaterial: material,
        AdditiveBlending: 2,
        Scene: class extends Obj3 {},
        Group: class extends Obj3 {},
        Mesh: class extends Obj3 { constructor(g, m) { super(); this.geometry = g; this.material = m; } },
        Sprite: class extends Obj3 { constructor(m) { super(); this.material = m; } },
        Points: class extends Obj3 { constructor(g, m) { super(); this.geometry = g; this.material = m; } },
        LineSegments: class extends Obj3 { constructor(g, m) { super(); this.geometry = g; this.material = m; } },
        PerspectiveCamera: class extends Obj3 { constructor(fov, aspect) { super(); this.fov = fov; this.aspect = aspect; } },
        WebGLRenderer: function () {
            this.getContext = () => ({});
            this.setPixelRatio = () => {};
            this.setClearColor = () => {};
            this.setSize = () => {};
            this.render = () => {};
        },
        Raycaster: function () {
            this.setFromCamera = () => {};
            this.intersectObjects = () => [];
        },
        Clock: function () {
            this.elapsedTime = 0;
            this.getDelta = () => { this.elapsedTime += 0.016; return 0.016; };
        }
    };
}

/* jsdom's canvas has no 2D context unless the optional `canvas` package is
   installed, and the page builds its glow sprites on one. */
function stubCanvas(window) {
    const noop = () => {};
    window.HTMLCanvasElement.prototype.getContext = function () {
        return {
            createRadialGradient: () => ({ addColorStop: noop }),
            fillRect: noop, clearRect: noop, beginPath: noop, closePath: noop,
            arc: noop, fill: noop, stroke: noop, moveTo: noop, lineTo: noop,
            save: noop, restore: noop, setTransform: noop, setLineDash: noop, fillText: noop,
            fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: ''
        };
    };
}

async function open(html, url, { withThree }) {
    const { JSDOM, VirtualConsole } = await requireJsdom();
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (e) => {
        if (/Could not load|Not implemented|Failed to fetch|resource/i.test(e.message)) return;
        errors.push(e.message);
    });

    const dom = new JSDOM(html, {
        runScripts: 'dangerously',
        url,
        virtualConsole,
        pretendToBeVisual: true,
        beforeParse(window) {
            stubCanvas(window);
            if (withThree) window.THREE = makeThreeStub();
        }
    });

    if (dom.window.document.readyState !== 'complete') {
        await new Promise((r) => dom.window.addEventListener('load', r));
    }
    return { dom, window: dom.window, document: dom.window.document, errors };
}

export default async function run(t, page) {
    const { html, url } = page;

    /* ------------------------------------------------------------------ */
    t.section('Single-file discipline');

    const scriptSrcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    t.eq('exactly one external script is loaded', scriptSrcs.length, 1);
    t.ok('and it is three.js from the same CDN the other pages use',
        scriptSrcs[0] === 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js');

    const links = [...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]);
    t.ok('the only stylesheet is Google Fonts', links.every((h) => h.startsWith('https://fonts.googleapis.com')));

    t.eq('there is exactly one inline script block', (html.match(/<script>/g) || []).length, 1);
    t.eq('the CSS is inline too', (html.match(/<style>/g) || []).length, 1);
    t.ok('the pure-math markers survive', html.includes('PURE MATH START') && html.includes('PURE MATH END'));

    /* Every id the script reaches for has to exist in the markup, or the page
       dies on load with a null dereference. */
    const wanted = new Set([...html.matchAll(/\$\('([a-z0-9-]+)'\)/gi)].map((m) => m[1]));
    const present = new Set([...html.matchAll(/id="([a-z0-9-]+)"/gi)].map((m) => m[1]));
    const missing = [...wanted].filter((id) => !present.has(id));
    t.eq('every element id the script looks up exists', missing.join(', ') || 'none', 'none');
    t.note(`${wanted.size} ids looked up, ${present.size} defined`);

    /* ------------------------------------------------------------------ */
    t.section('When three.js cannot be reached');

    const bare = await open(html, url, { withThree: false });
    const boot = bare.document.getElementById('boot');
    t.ok('the boot overlay is still on screen', !!boot && !boot.classList.contains('gone'));
    t.ok('and it says, in words, that three.js did not load',
        /three\.js did not load/i.test(boot ? boot.textContent : ''));
    t.eq('nothing throws on the way to that message', bare.errors.join(' | ') || 'none', 'none');
    bare.window.close();

    /* ------------------------------------------------------------------ */
    t.section('With three.js present');

    const app = await open(html, url, { withThree: true });
    const { document, window } = app;
    const $ = (id) => document.getElementById(id);
    const count = () => parseInt($('visible-count').textContent, 10);

    t.eq('no uncaught errors during boot', app.errors.join(' | ') || 'none', 'none');
    t.ok('the boot overlay steps aside', $('boot') === null || $('boot').classList.contains('gone'));

    const modelCount = (html.match(/^\{ id: '/gm) || []).length;
    t.ok(`the catalogue has ${modelCount} entries`, modelCount > 90);
    t.eq('all of them are visible when nothing is filtered', count(), modelCount);

    const legendRows = document.querySelectorAll('#legend-rows .leg-row');
    t.eq('the legend lists every lab', legendRows.length, 11);
    t.ok('and each shows a count', [...legendRows].every((r) => r.querySelector('.leg-n').textContent !== ''));

    t.eq('the status filter has six chips', document.querySelectorAll('#status-chips .chip').length, 6);
    t.eq('the view panel has four toggles', document.querySelectorAll('#view-chips .chip').length, 4);
    t.eq('the ranked rail lists every model', document.querySelectorAll('#ranked .rank-row').length, modelCount);

    const firstRow = document.querySelector('#ranked .rank-row');
    t.eq('the rail is sorted strongest first', firstRow.querySelector('.rank-n').textContent, '1');

    /* ------------------------------------------------------------------ */
    t.section('Selecting a model');

    const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    t.ok('the detail panel starts closed', !$('detail').classList.contains('open'));
    click(firstRow);
    t.ok('clicking a row opens it', $('detail').classList.contains('open'));
    t.eq('and names the top-ranked model', $('d-name').textContent, firstRow.querySelector('.rank-name').textContent);
    t.ok('with its lab', $('d-org').textContent.length > 1);
    t.ok('its rank out of the field', $('d-badges').textContent.includes('#1 of ' + modelCount));
    t.ok('its release date', /\d{4}/.test($('d-body').textContent));
    t.ok('and a per-million token price', $('d-body').textContent.includes('/ MTok'));
    t.ok('the sample-job cost is spelled out', /costs \$/.test($('d-body').textContent));
    t.ok('the row is marked as selected', firstRow.classList.contains('on'));

    const apiCode = $('d-body').querySelector('.d-api');
    t.ok('the API identifier is shown as code', !!apiCode && apiCode.textContent.length > 3);

    /* Stepping the ranking is the keyboard path, so drive the same function. */
    const weaker = $('d-body').querySelector('[data-step="1"]');
    const topName = $('d-name').textContent;
    click(weaker);
    t.ok('stepping to the next model changes the panel', $('d-name').textContent !== topName);

    const lin = $('d-body').querySelector('.lin-row');
    if (lin) {
        const linName = lin.textContent;
        click(lin);
        t.ok('following a lineage link navigates to that model', linName.includes($('d-name').textContent));
    } else {
        t.note('no lineage row on this model, skipped the link check');
    }

    click($('d-close'));
    t.ok('the close button closes the panel', !$('detail').classList.contains('open'));

    /* ------------------------------------------------------------------ */
    t.section('Filtering');

    const search = $('search');
    search.value = 'haiku';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    const haikuCount = count();
    t.ok(`searching narrows the swarm (${haikuCount} left)`, haikuCount > 0 && haikuCount < modelCount);
    t.ok('non-matching rows are dimmed', document.querySelectorAll('#ranked .rank-row.muted').length === modelCount - haikuCount);

    search.value = 'zzzznothing';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    t.eq('a search with no matches empties the swarm', count(), 0);

    search.value = '';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    t.eq('clearing the search restores everything', count(), modelCount);

    const anthropicRow = [...legendRows].find((r) => r.textContent.includes('Anthropic'));
    click(anthropicRow);
    const withoutAnthropic = count();
    t.ok('switching a lab off removes its models', withoutAnthropic < modelCount);
    t.ok('and the legend row dims', anthropicRow.classList.contains('off'));
    click(anthropicRow);
    t.eq('switching it back on restores them', count(), modelCount);

    const retiredChip = [...document.querySelectorAll('#status-chips .chip')].find((c) => c.textContent === 'Retired');
    click(retiredChip);
    t.ok('hiding retired models shrinks the swarm', count() < modelCount);
    click(retiredChip);
    t.eq('showing them again restores it', count(), modelCount);

    /* ------------------------------------------------------------------ */
    t.section('The timeline');

    const scrub = $('scrub');
    const maxMonth = parseInt(scrub.max, 10);
    const minMonth = parseInt(scrub.min, 10);
    t.ok('the scrubber starts fully wound forward', parseInt(scrub.value, 10) === maxMonth);
    t.ok('and spans at least seven years of months', maxMonth - minMonth >= 84);

    scrub.value = String(minMonth);
    scrub.dispatchEvent(new window.Event('input', { bubbles: true }));
    t.eq('wound back to the first month, only the oldest model remains', count(), 1);
    t.ok('the date readout follows the scrubber', /20\d\d/.test($('tl-date').textContent));

    /* Jan 2023 — the month before LLaMA leaked and two months before GPT-4. */
    const jan2023 = (2023 - 2018) * 12;
    scrub.value = String(jan2023);
    scrub.dispatchEvent(new window.Event('input', { bubbles: true }));
    const atJan2023 = count();
    t.ok(`only ${atJan2023} models existed by Jan 2023`, atJan2023 > 1 && atJan2023 < modelCount / 3);
    t.eq('the readout names that month', $('tl-date').textContent, 'Jan 2023');

    click($('reveal-all'));
    t.eq('"show everything" winds the timeline back out', count(), modelCount);
    t.eq('and resets the scrubber', parseInt(scrub.value, 10), maxMonth);

    /* ------------------------------------------------------------------ */
    t.section('View toggles');

    const viewChips = [...document.querySelectorAll('#view-chips .chip')];
    const lineageChip = viewChips.find((c) => c.textContent === 'Lineage');
    click(lineageChip);
    t.ok('turning lineage off dims its chip', lineageChip.classList.contains('off'));
    click(lineageChip);
    t.ok('and turning it back on restores it', !lineageChip.classList.contains('off'));

    /* ------------------------------------------------------------------ */
    t.section('Navigation');

    const swarm = window.__swarm;
    t.ok('the page exposes its camera state for driving', !!swarm && !!swarm.goal && !!swarm.view);

    t.ok('the navigator panel is on screen', !!$('navigator'));
    t.ok('with a top-down map', !!$('minimap'));

    const before = swarm.goal.dist;
    click($('zoom-in'));
    t.ok(`zoom in pulls the camera closer (${Math.round(before)} \u2192 ${Math.round(swarm.goal.dist)})`, swarm.goal.dist < before);
    const closer = swarm.goal.dist;
    click($('zoom-out'));
    t.ok('zoom out pushes it back', swarm.goal.dist > closer);

    /* Zoom must not be able to leave the model behind or bury the camera in it. */
    for (let i = 0; i < 40; i++) click($('zoom-in'));
    t.ok('zooming all the way in stops at the near limit', swarm.goal.dist >= 11);
    for (let i = 0; i < 60; i++) click($('zoom-out'));
    t.ok('zooming all the way out stops at the far limit', swarm.goal.dist <= 1000);

    click($('fit'));
    t.ok('"Fit" frames the whole swarm again', swarm.goal.dist > 200 && swarm.goal.dist < 500);
    t.near('and recentres on the core', Math.abs(swarm.goal.target.x) + Math.abs(swarm.goal.target.z), 0, 1e-9);

    const range = $('range');
    range.value = '10';
    range.dispatchEvent(new window.Event('input', { bubbles: true }));
    const nearDist = swarm.goal.dist;
    range.value = '95';
    range.dispatchEvent(new window.Event('input', { bubbles: true }));
    t.ok('the range slider drives the camera from core to rim', swarm.goal.dist > nearDist);
    t.ok('and its low end puts you inside the cloud', nearDist < 60);

    const presets = [...document.querySelectorAll('[data-preset]')];
    t.eq('there are four camera presets', presets.length, 4);
    click(presets.find((c) => c.getAttribute('data-preset') === 'top'));
    const topPhi = swarm.goal.phi;
    click(presets.find((c) => c.getAttribute('data-preset') === 'side'));
    t.ok('"Top" looks down and "Side" looks along the equator', topPhi < swarm.goal.phi);
    t.near('"Side" sits exactly on the equator', swarm.goal.phi, Math.PI / 2, 1e-9);

    /* Flying to a lab arm should leave the origin and head that lab's way. */
    swarm.resetView();
    swarm.flyToArm('anthropic');
    const arm = swarm.layout.arms.anthropic;
    const tgt = swarm.goal.target;
    const reach = Math.hypot(tgt.x, tgt.y, tgt.z);
    t.ok('flying to a lab leaves the core behind', reach > 30);
    const dot = (tgt.x * arm.x + tgt.y * arm.y + tgt.z * arm.z) / (reach || 1);
    t.ok('and heads down that lab\u2019s arm', dot > 0.9);

    const goBtn = anthropicRow.querySelector('.leg-go');
    t.ok('every legend row has a fly-to control', !!goBtn);
    swarm.resetView();
    click(goBtn);
    t.ok('clicking it flies to that arm', Math.hypot(swarm.goal.target.x, swarm.goal.target.z) > 10);
    t.eq('without toggling the lab off', anthropicRow.classList.contains('off'), false);

    /* ------------------------------------------------------------------ */
    t.section('The map');

    /* jsdom reports a zero-sized box for everything, so give the map one. */
    const MAP_W = 236, MAP_H = 176;
    $('minimap').getBoundingClientRect = () => ({ left: 0, top: 0, width: MAP_W, height: MAP_H, right: MAP_W, bottom: MAP_H });
    window.dispatchEvent(new window.Event('resize'));

    const mapScale = (Math.min(MAP_W, MAP_H) / 2 - 7) / 118;
    const mapClick = (x, y) => $('minimap').dispatchEvent(
        new window.MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));

    /* A dot on the map is a model; clicking it should open that model. */
    const target = swarm.nodes[0];
    mapClick(MAP_W / 2 + target.base.x * mapScale, MAP_H / 2 + target.base.z * mapScale);
    t.eq('clicking a dot on the map opens that model', $('d-name').textContent, target.model.name);

    /* Empty map space is a destination, not a model. */
    click($('d-close'));
    swarm.resetView();
    mapClick(8, 8);
    t.ok('clicking empty map space flies the camera there',
        Math.hypot(swarm.goal.target.x, swarm.goal.target.z) > 50);
    t.ok('and does not open a model', !$('detail').classList.contains('open'));

    /* ------------------------------------------------------------------ */
    t.section('Flying with the keyboard');

    const nextFrame = () => new Promise((r) => window.requestAnimationFrame(() => window.requestAnimationFrame(r)));
    const key = (type, k) => window.dispatchEvent(new window.KeyboardEvent(type, { key: k, bubbles: true }));

    swarm.resetView();
    await nextFrame();
    const start = { x: swarm.goal.target.x, y: swarm.goal.target.y, z: swarm.goal.target.z };

    key('keydown', 'w');
    await nextFrame();
    key('keyup', 'w');
    const moved = Math.hypot(swarm.goal.target.x - start.x, swarm.goal.target.y - start.y, swarm.goal.target.z - start.z);
    t.ok(`holding W moves the camera through the cloud (${moved.toFixed(1)}u)`, moved > 0);

    const afterRelease = { x: swarm.goal.target.x, z: swarm.goal.target.z };
    await nextFrame();
    t.near('releasing it stops the drift', Math.hypot(swarm.goal.target.x - afterRelease.x, swarm.goal.target.z - afterRelease.z), 0, 1e-9);

    /* A key held while the window loses focus must not fly forever. */
    key('keydown', 'w');
    window.dispatchEvent(new window.Event('blur'));
    const parked = { x: swarm.goal.target.x, z: swarm.goal.target.z };
    await nextFrame();
    t.near('losing focus releases a held key', Math.hypot(swarm.goal.target.x - parked.x, swarm.goal.target.z - parked.z), 0, 1e-9);

    /* Flight must stay near the swarm rather than drifting off into nothing. */
    swarm.goal.target.set(9999, 9999, 9999);
    key('keydown', 'd');
    await nextFrame();
    key('keyup', 'd');
    t.ok('flight is bounded to the neighbourhood of the swarm',
        Math.abs(swarm.goal.target.x) <= 118 * 1.45 + 0.001);

    /* ------------------------------------------------------------------ */
    t.section('Nearby models');

    swarm.resetView();
    t.ok('the nearby list is hidden when the whole swarm is in frame', !$('nearby').classList.contains('on'));

    range.value = '5';
    range.dispatchEvent(new window.Event('input', { bubbles: true }));
    for (let i = 0; i < 30; i++) await nextFrame();

    t.ok('it appears once you are inside the cloud', $('nearby').classList.contains('on'));
    const nearRows = document.querySelectorAll('#near-rows .near-row');
    t.ok(`and lists what is closest (${nearRows.length} rows)`, nearRows.length > 0 && nearRows.length <= 6);

    if (nearRows.length) {
        const nearName = nearRows[0].querySelector('.near-name').textContent;
        click(nearRows[0]);
        t.eq('clicking a nearby model opens it', $('d-name').textContent, nearName);
        click($('d-close'));
    }

    /* ------------------------------------------------------------------ */
    t.section('Panels and help');

    t.ok('the help popover starts closed', !$('helppop').classList.contains('on'));
    click($('helpbtn'));
    t.ok('the ? button opens it', $('helppop').classList.contains('on'));
    t.ok('it documents the flight keys', /WASD|W<\/kbd>/i.test($('helppop').innerHTML));
    t.ok('and still carries the data provenance note', /September 2026/.test($('helppop').textContent));
    click($('helpbtn'));
    t.ok('clicking it again closes it', !$('helppop').classList.contains('on'));

    const nav = $('navigator');
    t.ok('the navigator starts open', !nav.classList.contains('folded'));
    click($('nav-head'));
    t.ok('its header folds it away to reclaim space', nav.classList.contains('folded'));
    click($('nav-head'));
    t.ok('and unfolds it again', !nav.classList.contains('folded'));

    t.eq('no uncaught errors after driving the whole HUD', app.errors.join(' | ') || 'none', 'none');
    app.window.close();

    /* ------------------------------------------------------------------ */
    t.section('Deep links');

    const deep = await open(html, url + '#opus-5', { withThree: true });
    t.ok('a #model-id hash opens that model on load', deep.document.getElementById('detail').classList.contains('open'));
    t.eq('and it is the right one', deep.document.getElementById('d-name').textContent, 'Claude Opus 5');
    t.eq('nothing throws on a deep link', deep.errors.join(' | ') || 'none', 'none');
    deep.window.close();

    const bogus = await open(html, url + '#not-a-real-model', { withThree: true });
    t.ok('an unknown hash is ignored rather than fatal',
        !bogus.document.getElementById('detail').classList.contains('open'));
    t.eq('and still throws nothing', bogus.errors.join(' | ') || 'none', 'none');
    bogus.window.close();
}
