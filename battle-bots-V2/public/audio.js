import { TEAMS } from './teams.js';

let audioCtx;

export function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function envelope(type, startFreq, endFreq, peak, duration, oscType) {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = oscType;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
    gain.gain.setValueAtTime(peak, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
    osc.start(now); osc.stop(now + duration);
}

// Each team fires at its own pitch so a four-way fight stays readable by ear.
export function playShot(team) {
    const t = TEAMS[team];
    envelope('shoot', t ? t.tone : 500, 100, 0.05, 0.1, team === 'blue' || team === 'yellow' ? 'square' : 'sawtooth');
}

export function playSound(type) {
    if (type === 'hit') envelope('hit', 150, 50, 0.1, 0.1, 'triangle');
    else if (type === 'explode') envelope('explode', 100, 20, 0.2, 0.5, 'square');
}
