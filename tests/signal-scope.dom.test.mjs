/* signal-scope.html — Web Audio API synth sequencer + visualizer.
 *
 * jsdom implements neither `AudioContext`/`webkitAudioContext` nor a native
 * 2D canvas backend, so this suite exercises the page's own "unsupported"
 * fallback path and its pure state-management logic (waveform/tempo/cutoff/
 * viz-mode/mic-toggle), never real audio synthesis or canvas drawing.
 */

import { openDom } from './lib/page.mjs';

export const name = 'Signal Scope — no-Web-Audio fallback and sequencer controls';

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

        const api = window.__signalscope;
        t.ok('the page exposes its test hooks', !!api);
        if (!api) return;

        t.section('Web Audio is unavailable in jsdom');

        t.eq('webAudioAvailable reads false', api.webAudioAvailable, false);
        t.ok('the audio banner is shown', document.getElementById('audio-banner').classList.contains('show'));
        t.eq('the play button is disabled', document.getElementById('play-btn').disabled, true);
        t.eq('isPlaying reads false before any interaction', api.isPlaying, false);

        t.section('The 16-step pattern is pinned');

        t.eq('the pattern has 16 steps', api.pattern.length, 16);
        t.ok('every step is a positive frequency', api.pattern.every((hz) => typeof hz === 'number' && hz > 0));

        t.section('play()/stop() never construct a real AudioContext');

        api.play();
        t.eq('play() does not flip isPlaying without Web Audio', api.isPlaying, false);
        api.stop();
        t.eq('stop() is still safe to call', api.isPlaying, false);
        api.play();
        api.play();
        t.eq('calling play() twice in a row is still safe to call', api.isPlaying, false);

        t.section('Control state updates independently of audio support');

        api.setWaveform('square');
        t.eq('setWaveform updates the select value', document.getElementById('waveform').value, 'square');
        api.setWaveform('not-a-real-waveform');
        t.eq('an unknown waveform is ignored', document.getElementById('waveform').value, 'square');

        api.setTempo(999);
        t.eq('setTempo clamps to the upper bound', document.getElementById('tempo').value, '200');
        api.setTempo(1);
        t.eq('setTempo clamps to the lower bound', document.getElementById('tempo').value, '60');

        api.setCutoff(50000);
        t.eq('setCutoff clamps to the upper bound', document.getElementById('cutoff').value, '8000');
        api.setCutoff(0);
        t.eq('setCutoff clamps a literal 0 to the lower bound, not the default', document.getElementById('cutoff').value, '200');

        api.setTempo(0);
        t.eq('setTempo clamps a literal 0 to the lower bound, not the default', document.getElementById('tempo').value, '60');

        api.setVizMode('radial');
        const radialBtn = document.querySelector('.mode-btn[data-mode="radial"]');
        t.ok('setVizMode marks the radial button active', radialBtn.classList.contains('active'));
        api.setVizMode('bogus-mode');
        t.ok('an unknown viz mode is ignored, radial stays active', radialBtn.classList.contains('active'));

        t.section('Microphone toggle falls back cleanly when getUserMedia is unavailable');

        t.eq('micEnabled() starts false', api.micEnabled(), false);
        const micToggle = document.getElementById('mic-toggle');
        micToggle.checked = true;
        micToggle.dispatchEvent(new window.Event('change', { bubbles: true }));
        t.eq('micEnabled() stays false when getUserMedia is unavailable', api.micEnabled(), false);
        t.eq('the mic checkbox is unchecked again', micToggle.checked, false);
        t.ok('a fallback status message is shown', document.getElementById('mic-status').textContent.length > 0);
    } finally {
        env.close();
    }
}
