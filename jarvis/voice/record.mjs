/* J.A.R.V.I.S.: record his fixed lines in his own voice (Session 18 of jarvis/build-plan.html).
 *
 * Run by .github/workflows/jarvis-voice.yml from the Actions tab, never on a schedule. For each skin it takes the lines
 * collect.mjs found, works out which are new or changed since manifest.json, and asks Gemini's text-to-speech model
 * for those only, with the same voice, style and request the proxy's /api/voice uses (jarvis/cloud/lib/core.js), so a
 * recording sounds like the live voice. Each answer is encoded as a small MP3 with ffmpeg and saved as
 * <skin>/<fingerprint>.mp3, where the fingerprint is a hash of the skin, the voice, its style and the exact words: a
 * new voice or new words make a new file, and a file's name never points at old audio. manifest.json lists every
 * recording with its SHA-256 and size. Lines the page no longer says are removed, with their files.
 *
 *   node jarvis/voice/record.mjs --lines=lines.json --dry-run    what would be recorded, and its size. No key, no network.
 *   node jarvis/voice/record.mjs --lines=lines.json              records (needs GEMINI_API_KEY in the environment)
 *
 * Options: --limit=N lines per run (default 400), --pace=ms between requests (default 7000, for Google's per-minute
 * limit on text-to-speech), --max-mb=N stops before the recordings pass N MB (default 60).
 *
 * The key is read from the environment only, sent as a header, and never written anywhere. Nothing here logs the
 * words beyond the line counts. tests/jarvis-voice.test.mjs runs plan() and record() against a fake Gemini. */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, unlink, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GEMINI, VOICES, voiceBody, readVoice, wav, pickVoiceModel, scrub } from '../cloud/lib/core.js';

export const DIR = fileURLToPath(new URL('./', import.meta.url));
export const SKINS = ['jarvis', 'matrix', 'panther'];
export const BYTES_PER_CHAR = 450; // a rough guess for the dry run: MP3 at 48 kbit/s, about 14 characters a second
const FILE = /^[a-f0-9]{16}\.mp3$/;

export const fingerprint = (skin, text) => createHash('sha256')
    .update([skin, VOICES[skin].name, VOICES[skin].style, text].join('\n')).digest('hex').slice(0, 16);

export function emptyManifest() { return { version: 1, model: null, voices: {}, lines: {} }; }
export async function readManifest(dir = DIR) {
    try {
        const m = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
        return m && typeof m === 'object' && m.lines && typeof m.lines === 'object' ? m : emptyManifest();
    } catch { return emptyManifest(); }
}
// Stable output: skins and lines sorted, so a re-run that changes nothing changes no byte.
export function manifestText(m) {
    const lines = {};
    for (const k of SKINS) {
        const L = m.lines[k] || {};
        lines[k] = Object.fromEntries(Object.keys(L).sort().map(t => [t, L[t]]));
    }
    const voices = Object.fromEntries(SKINS.map(k => [k, { name: VOICES[k].name, style: VOICES[k].style }]));
    return JSON.stringify({ version: 1, model: m.model || null, voices, lines }, null, 1) + '\n';
}

// What to do: {todo: [{skin, text, file}], stale: [{skin, text, file}], keep, chars, bytes}. No network.
export async function plan(lines, manifest, dir = DIR) {
    const todo = [], stale = [];
    let keep = 0, chars = 0, bytes = 0;
    for (const k of SKINS) {
        const want = new Set(lines[k] || []), have = manifest.lines[k] || {};
        for (const [t, e] of Object.entries(have))
            if (!want.has(t) || !e || e.file !== fingerprint(k, t) + '.mp3') stale.push({ skin: k, text: t, file: e && e.file });
        for (const t of want) {
            const e = have[t], file = fingerprint(k, t) + '.mp3';
            let there = false;
            if (e && e.file === file) try { there = (await stat(join(dir, k, file))).size === e.bytes; } catch { there = false; }
            if (there) { keep++; bytes += e.bytes; } else { todo.push({ skin: k, text: t, file }); chars += t.length; }
        }
    }
    return { todo, stale, keep, chars, bytes, estimate: bytes + chars * BYTES_PER_CHAR };
}

// WAV to MP3 with ffmpeg: mono, 24 kHz, 48 kbit/s, no metadata (so the same audio always makes the same bytes).
export function ffmpegEncode(wavBytes) {
    return new Promise((resolve, reject) => {
        const base = join(tmpdir(), 'jarvis-voice-' + process.pid + '-' + Math.random().toString(36).slice(2));
        writeFile(base + '.wav', wavBytes).then(() => {
            execFile('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', base + '.wav', '-ac', '1', '-ar', '24000', '-codec:a', 'libmp3lame', '-b:a', '48k',
                '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '0', '-fflags', '+bitexact', base + '.mp3'], async (err) => {
                try {
                    if (err) throw err;
                    resolve(await readFile(base + '.mp3'));
                } catch (e) { reject(e); } finally { unlink(base + '.wav').catch(() => {}); unlink(base + '.mp3').catch(() => {}); }
            });
        }, reject);
    });
}

const wait = ms => new Promise(r => setTimeout(r, ms));
// Records what plan() found. fetchImpl, encode and log are passed in so the suite can run it without the network.
export async function record({ lines, dir = DIR, key, fetchImpl = fetch, encode = ffmpegEncode, log = console.log, limit = 400, pace = 7000, maxMb = 60, model: want = null }) {
    if (!key) throw new Error('GEMINI_API_KEY is not set. Add it as a repository secret in Settings → Secrets and variables → Actions.');
    const manifest = await readManifest(dir);
    const p = await plan(lines, manifest, dir);
    for (const s of p.stale) {
        delete manifest.lines[s.skin][s.text];
        if (s.file && FILE.test(s.file)) await unlink(join(dir, s.skin, s.file)).catch(() => {});
    }
    const res = await fetchImpl(`${GEMINI}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
    if (!res.ok) throw new Error(`The model list answered ${res.status}`);
    const models = ((await res.json()).models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => String(m.name).replace(/^models\//, ''));
    const model = pickVoiceModel(want, models);
    if (!model) throw new Error('Google lists no text-to-speech model for this key.');
    log(`Model: ${model} (from Google's live list). ${p.todo.length} to record, ${p.keep} kept, ${p.stale.length} removed.`);
    if (manifest.model && manifest.model !== model) log(`Note: earlier recordings used ${manifest.model}.`);
    let total = p.bytes, done = 0, failed = 0;
    for (const item of p.todo.slice(0, limit)) {
        if (total > maxMb * 1e6) { log(`Stopped at ${maxMb} MB. Raise --max-mb to record the rest.`); break; }
        let out = null;
        for (let tries = 0; tries < 5; tries++) {
            const r = await fetchImpl(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
                method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(voiceBody({ skin: item.skin, text: item.text }))
            });
            const data = await r.json().catch(() => null);
            if (r.status === 429 || r.status >= 500) { log(`Google answered ${r.status}; waiting.`); await wait(Math.max(pace, 1) * (tries + 2)); continue; }
            if (!r.ok) { log(`Google answered ${r.status}: ${scrub(data && data.error && data.error.message)}`); break; }
            out = readVoice(data);
            break;
        }
        if (!out || !out.pcm) { failed++; log(`Not recorded (${item.skin}, ${item.text.length} characters): ${out ? out.error || 'blocked' : 'no answer'}`); continue; }
        const mp3 = await encode(wav(out.pcm, out.rate));
        await mkdir(join(dir, item.skin), { recursive: true });
        await writeFile(join(dir, item.skin, item.file), mp3);
        (manifest.lines[item.skin] ||= {})[item.text] = { file: item.file, sha256: createHash('sha256').update(mp3).digest('hex'), bytes: mp3.length };
        manifest.model = model;
        total += mp3.length; done++;
        // Written after every line, so a run that stops halfway keeps what it recorded.
        await writeFile(join(dir, 'manifest.json'), manifestText(manifest));
        if (pace) await wait(pace);
    }
    await writeFile(join(dir, 'manifest.json'), manifestText(manifest));
    log(`Recorded ${done}, failed ${failed}, ${p.todo.length - done - failed} left for another run. Recordings: ${(total / 1e6).toFixed(2)} MB.`);
    return { done, failed, total, model };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
    const lines = JSON.parse(await readFile(arg('lines', ''), 'utf8'));
    if (process.argv.includes('--dry-run')) {
        const p = await plan(lines, await readManifest());
        const n = Object.fromEntries(SKINS.map(k => [k, (lines[k] || []).length]));
        console.log(`Lines: ${SKINS.map(k => `${k} ${n[k]}`).join(', ')}.`);
        console.log(`To record: ${p.todo.length} lines, ${p.chars} characters. Kept: ${p.keep}. To remove: ${p.stale.length}.`);
        console.log(`Size: about ${(p.estimate / 1e6).toFixed(2)} MB of recordings once done (a guess at ${BYTES_PER_CHAR} bytes a character).`);
        process.exit(0);
    }
    try {
        await record({ lines, key: process.env.GEMINI_API_KEY, limit: +arg('limit', 400), pace: +arg('pace', 7000), maxMb: +arg('max-mb', 60), model: process.env.JARVIS_VOICE_MODEL || null });
    } catch (e) { console.error(scrub(e.message)); process.exit(1); }
}
