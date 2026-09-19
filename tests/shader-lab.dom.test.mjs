/* shader-lab.html — raw WebGL2/GLSL shader playground.
 *
 * jsdom has no WebGL backend, so `canvas.getContext('webgl2')` returns null
 * there — the same path a browser without WebGL2 support would take. This
 * suite exercises that fallback and the preset/speed/hue state machine
 * around it, never the actual GL rendering (see shader-lab.core.test.mjs for
 * that — it pins the literal GLSL source instead).
 */

import { openDom } from './lib/page.mjs';

export const name = 'Shader Lab — no-WebGL2 fallback and preset controls';

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

        const api = window.__shaderlab;
        t.ok('the page exposes its test hooks', !!api);
        if (!api) return;

        t.section('WebGL2 is unavailable in jsdom');

        t.eq('webgl2Available reads false', api.webgl2Available, false);
        t.ok('the no-GL placeholder is shown', document.getElementById('no-gl-placeholder').classList.contains('show'));
        t.ok('the GL banner is shown', document.getElementById('gl-banner').classList.contains('show'));
        t.eq('the play button is disabled', document.getElementById('play-btn').disabled, true);
        t.eq('isPlaying() reads false', api.isPlaying(), false);

        t.section('Preset/speed/hue state still updates without a GL context');

        t.eq('four presets are exposed', api.presets.length, 4);
        t.eq('plasma is the default preset', api.currentPreset(), 'plasma');

        api.setPreset('tunnel');
        t.eq('setPreset updates the current preset', api.currentPreset(), 'tunnel');
        const activeBtn = document.querySelector('.preset-btn.active');
        t.eq('the matching preset button is marked active', activeBtn && activeBtn.dataset.preset, 'tunnel');

        api.setPreset('not-a-real-preset');
        t.eq('an unknown preset id is ignored', api.currentPreset(), 'tunnel');

        api.setSpeed(10);
        t.eq('setSpeed clamps to the upper bound', document.getElementById('speed').value, '3');
        api.setSpeed(-5);
        t.eq('setSpeed clamps to the lower bound', document.getElementById('speed').value, '0.1');
        api.setSpeed(0);
        t.eq('setSpeed clamps a literal 0 to the lower bound, not the default', document.getElementById('speed').value, '0.1');

        api.setHue(400);
        t.eq('setHue wraps values above 360', document.getElementById('hue').value, '40');
        api.setHue(-30);
        t.eq('setHue wraps negative values', document.getElementById('hue').value, '330');

        t.section('play()/pause() are safe no-ops without WebGL2');

        api.play();
        t.eq('play() does not flip isPlaying() without a GL context', api.isPlaying(), false);
        api.pause();
        t.eq('pause() is still safe to call', api.isPlaying(), false);
    } finally {
        env.close();
    }
}
