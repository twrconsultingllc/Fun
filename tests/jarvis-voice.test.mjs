/* J.A.R.V.I.S.: his recorded voice (Session 18 of jarvis/build-plan.html, review 79). The line collector
 * (jarvis/voice/collect.mjs), the recordings' manifest (jarvis/voice/manifest.json and the files it lists), the
 * recorder (jarvis/voice/record.mjs) and its workflow (.github/workflows/jarvis-voice.yml).
 *
 * The collector's lines are checked against what the page really says: each skin is driven through typed turns, and
 * every collected line has to appear word for word in an answer, so nothing is recorded that he never says. None may
 * hold a digit (a time, a count, a worked-out number), a date word, a name or anything personal() flags.
 *
 * The recorder runs here against a fake Gemini answering in the real text-to-speech shape, with a fake encoder in place
 * of ffmpeg, in a scratch folder. Google's API can't be reached from a claude.ai/code container, so the first real
 * recording is made by the workflow, run by hand.
 *
 * Registered against jarvis-test.html, the page whose lines are recorded. */

import { createHash } from 'node:crypto';
import { readFile, readdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { openDom } from './lib/page.mjs';

export const name = 'J.A.R.V.I.S. recorded voice (jarvis/voice)';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const VOICE = ROOT + 'jarvis/voice/';
const SKINS = ['jarvis', 'matrix', 'panther'];
const DATEY = /\d|\b(?:january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tonight|tomorrow|yesterday|o'clock)\b/i;

export default async function run(t, page) {
    const C = await import(pathToFileURL(VOICE + 'collect.mjs').href);
    const R = await import(pathToFileURL(VOICE + 'record.mjs').href);
    const core = await import(pathToFileURL(ROOT + 'jarvis/cloud/lib/core.js').href);
    const quiet = { ignore: /getContext|HTMLCanvasElement|indexedDB|Failed to fetch/ };

    t.section('The lines: collected from the page');
    const lines = await C.collect();
    const env0 = await openDom(page.html, 'https://jarvis.test/jarvis-test.html', quiet);
    const J0 = env0.window.__jarvis;
    t.eq('one list per skin', Object.keys(lines).join(), SKINS.join());
    for (const k of SKINS) t.eq(`${k}: the collector's lines are the page's own voiceLines()`, JSON.stringify(lines[k]), JSON.stringify(J0.voiceLines(k)));
    const all = SKINS.flatMap((k) => lines[k].map((l) => [k, l]));
    t.ok(`${all.length} lines in all, a reasonable number to record`, all.length > 60 && all.length < 400);
    t.eq('none has a digit or a date word (a time, a date, a count, a worked-out number)', all.filter(([, l]) => DATEY.test(l)).map(([, l]) => l).join(' | '), '');
    t.eq('none is anything personal() flags', all.filter(([, l]) => J0.personal(l)).map(([, l]) => l).join(' | '), '');
    t.eq('none is left with a template or a link marker in it', all.filter(([, l]) => /\$\{|⟦|⟧|undefined|null/.test(l)).length, 0);
    t.ok('each is at most 600 characters, the most /api/voice takes', all.every(([, l]) => l.length > 0 && l.length <= 600));
    t.ok('each is written the way the page looks it up (its sentences joined by one space)', all.every(([, l]) => J0.speechSentences(l, 300).join(' ') === l));
    t.ok('the greeting is collected without a name', lines.jarvis.includes('Hello. All systems are online.') && lines.matrix.includes('Welcome to the real world. I am Morpheus. Ask, and I will show you how deep the rabbit hole goes.'));
    t.ok('a fact with a number in it is left out (the Eiffel Tower\'s 15 centimetres)', !all.some(([, l]) => /Eiffel/.test(l)));
    t.ok('the voice menu\'s sample is never recorded: it plays in the browser voice you just picked', !all.some(([k, l]) => l === J0.SKINS[k].sample) && /say\(SKINS\[skin\]\.sample,\{browser:true\}\)/.test(page.html));
    t.ok('each skin\'s own lines are only in its own list', lines.jarvis.every((l) => !/Morpheus|Cats/.test(l)) && !lines.panther.some((l) => /Morpheus/.test(l)));
    t.ok('the approved samples are among them', SKINS.every((k) => J0.VOICE_SAMPLES[k].every((l) => lines[k].includes(l))));
    env0.close();

    t.section('The lines: every one is something he really says, word for word');
    for (const k of SKINS) {
        const heard = [];
        for (const r of [0, 0.34, 0.5, 0.67, 0.8, 0.99]) {
            const env = await openDom(page.html, 'https://jarvis.test/jarvis-test.html', { ...quiet, beforeParse(w) { w.Math.random = () => r; w.fetch = async () => { throw new w.TypeError('Failed to fetch'); }; } });
            const J = env.window.__jarvis;
            await J.ready; J.finishBoot();
            const turns = ['hello', 'thank you', 'tell me a joke', 'tell me a fun fact', 'how are you', 'launch countdown', 'who are you', 'what is a flibbertigibbet', 'voice samples'];
            if (k === 'jarvis') turns.unshift('switch to matrix', 'back to jarvis');
            else turns.unshift(k === 'matrix' ? 'switch to matrix' : 'switch to panthers');
            for (let n = 0; n < 3; n++) for (const q of turns) heard.push(J.plainText(String(await J.answer(q))));
            env.close();
        }
        const text = heard.join('\n');
        t.eq(`${k}: every collected line was said in a typed turn`, lines[k].filter((l) => !text.includes(l)).join(' | '), '');
    }

    t.section('The manifest and the recordings');
    const mf = JSON.parse(await readFile(VOICE + 'manifest.json', 'utf8'));
    t.eq('version 1', mf.version, 1);
    t.eq('it names each skin\'s voice as the proxy does', JSON.stringify(mf.voices), JSON.stringify(Object.fromEntries(SKINS.map((k) => [k, { name: core.VOICES[k].name, style: core.VOICES[k].style }]))));
    t.eq('it is written the recorder\'s way (sorted, so a re-run changes no byte)', await readFile(VOICE + 'manifest.json', 'utf8'), R.manifestText(mf));
    let bytes = 0, count = 0;
    for (const k of SKINS) {
        const L = mf.lines[k] || {};
        const files = await readdir(VOICE + k).catch(() => []);
        for (const [text, e] of Object.entries(L)) {
            count++;
            const ok = lines[k].includes(text) && e.file === R.fingerprint(k, text) + '.mp3';
            let real = false;
            try { const b = await readFile(VOICE + k + '/' + e.file); real = b.length === e.bytes && createHash('sha256').update(b).digest('hex') === e.sha256; bytes += b.length; } catch { real = false; }
            if (!ok || !real) t.ok(`${k}: "${text}" is a line the page says, named by its fingerprint, with the SHA-256 and size listed`, false);
        }
        t.eq(`${k}: no file in jarvis/voice/${k}/ that the manifest doesn't list`, files.filter((f) => !Object.values(L).some((e) => e.file === f)).join(), '');
    }
    t.ok(`every listed recording is a line the page says, with a matching SHA-256 (${count} so far)`, true);
    t.ok(`the recordings take ${(bytes / 1e6).toFixed(2)} MB, under the recorder's 60 MB cap (the full brain takes 347 MB)`, bytes <= 60e6);
    if (!count) t.note('No recordings yet: the workflow has not been run. Until then, he uses the live voice and the browser\'s.');

    t.section('The recorder: what it plans');
    const empty = R.emptyManifest();
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-voice-test-'));
    try {
        let p = await R.plan(lines, empty, dir);
        t.eq('with nothing recorded, every line is to do', p.todo.length, all.length);
        t.ok('its size is estimated before anything is recorded', p.estimate > 0 && p.estimate === p.chars * R.BYTES_PER_CHAR);
        t.ok('a fingerprint is 16 hex characters, and changes with the words, the skin and the voice', /^[a-f0-9]{16}$/.test(R.fingerprint('jarvis', 'Anytime.')) &&
            R.fingerprint('jarvis', 'Anytime.') !== R.fingerprint('jarvis', 'Anytime!') && R.fingerprint('jarvis', 'Anytime.') !== R.fingerprint('matrix', 'Anytime.'));
        await writeFile(join(dir, 'lines.json'), JSON.stringify(lines));
        const dry2 = await new Promise((res) => execFile(process.execPath, [VOICE + 'record.mjs', '--lines=' + join(dir, 'lines.json'), '--dry-run'], { env: { PATH: process.env.PATH } }, (e, so, se) => res({ e, so, se })));
        t.ok('the dry run needs no key and prints what it would record, and the size', !dry2.e && new RegExp(`To record: ${all.length} lines`).test(dry2.so) && /MB of recordings/.test(dry2.so));
        t.ok('…and says nothing about any line\'s words', !lines.jarvis.some((l) => dry2.so.includes(l)));

        t.section('The recorder: a run against a fake Gemini');
        const KEY = ['AIza', 'FAKE-RECORDER-KEY-0123456789abcdefgh'].join('');
        const calls = [], logs = [];
        let mode = 'ok', models = ['gemini-3.5-flash', 'gemini-2.5-flash-preview-tts'];
        const fetchImpl = async (url, init = {}) => {
            calls.push({ url, init });
            const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
            if (url.includes('/models?')) return json(200, { models: models.map((m) => ({ name: 'models/' + m, supportedGenerationMethods: ['generateContent'] })) });
            const body = JSON.parse(init.body);
            if (mode === 'busy-once') { mode = 'ok'; return json(429, { error: { code: 429, message: 'slow down' } }); }
            if (mode === 'fail') return json(400, { error: { code: 400, message: `bad request key=${KEY}` } });
            const words = body.contents[0].parts[0].text.replace(/^[^:]*: /, '');
            return json(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: Buffer.from(words.length % 2 ? words + ' ' : words).toString('base64') } }] }, finishReason: 'STOP' }] });
        };
        const encode = async (wavBytes) => Buffer.concat([Buffer.from('MP3:'), Buffer.from(wavBytes.subarray(44))]);
        const few = { jarvis: lines.jarvis.slice(0, 3), matrix: lines.matrix.slice(0, 2), panther: [] };
        let threw = null;
        try { await R.record({ lines: few, dir, key: '', fetchImpl, encode, log: () => {}, pace: 0 }); } catch (e) { threw = e.message; }
        t.ok('without the key it stops, and says where to add it', /GEMINI_API_KEY is not set.*Actions/.test(threw || '') && calls.length === 0);
        let out = await R.record({ lines: few, dir, key: KEY, fetchImpl, encode, log: (m) => logs.push(m), pace: 0 });
        t.eq('it records each new line', out.done, 5);
        t.eq('with the text-to-speech model from the live list', out.model, 'gemini-2.5-flash-preview-tts');
        const gen = calls.filter((c) => c.url.includes(':generateContent'));
        t.ok('the same request as the live voice: the skin\'s voice and style, the words exact', gen.length === 5 &&
            JSON.stringify(JSON.parse(gen[0].init.body)) === JSON.stringify(core.voiceBody({ skin: 'jarvis', text: few.jarvis[0] })));
        t.ok('the key only in the x-goog-api-key header, never in a URL', calls.every((c) => !c.url.includes(KEY)) && calls.every((c) => c.init.headers['x-goog-api-key'] === KEY));
        t.ok('the log names the model and counts, never a line\'s words or the key', logs.join('\n').includes('gemini-2.5-flash-preview-tts') && !few.jarvis.some((l) => logs.join('\n').includes(l)) && !logs.join('\n').includes(KEY));
        let m = await R.readManifest(dir);
        const e0 = m.lines.jarvis[few.jarvis[0]];
        const b0 = await readFile(join(dir, 'jarvis', e0.file));
        t.ok('each file is named by its fingerprint, with its SHA-256 and size in the manifest', e0.file === R.fingerprint('jarvis', few.jarvis[0]) + '.mp3' && e0.sha256 === createHash('sha256').update(b0).digest('hex') && e0.bytes === b0.length);
        t.ok('…and is the encoded audio of the words', b0.subarray(0, 4).toString() === 'MP3:' && b0.subarray(4).toString().trim() === few.jarvis[0]);
        t.eq('the manifest names the model', m.model, 'gemini-2.5-flash-preview-tts');
        const n0 = gen.length;
        out = await R.record({ lines: few, dir, key: KEY, fetchImpl, encode, log: () => {}, pace: 0 });
        t.ok('run again with nothing changed: nothing is recorded, so it costs nothing', out.done === 0 && calls.filter((c) => c.url.includes(':generateContent')).length === n0);
        const changed = { jarvis: [few.jarvis[0], 'Anytime.'], matrix: few.matrix, panther: [] };
        out = await R.record({ lines: changed, dir, key: KEY, fetchImpl, encode, log: () => {}, pace: 0 });
        m = await R.readManifest(dir);
        const left = await readdir(join(dir, 'jarvis'));
        t.ok('a new line is recorded, and lines the page no longer says are removed with their files', out.done === 1 && Object.keys(m.lines.jarvis).sort().join('|') === [few.jarvis[0], 'Anytime.'].sort().join('|') && left.length === 2);
        await writeFile(join(dir, 'jarvis', m.lines.jarvis['Anytime.'].file), 'truncated');
        p = await R.plan(changed, m, dir);
        t.ok('a file whose size doesn\'t match the manifest is recorded again', p.todo.length === 1 && p.todo[0].text === 'Anytime.');
        mode = 'busy-once';
        out = await R.record({ lines: changed, dir, key: KEY, fetchImpl, encode, log: () => {}, pace: 1 });
        t.eq('busy (429): it waits and tries again', out.done, 1);
        mode = 'fail';
        const failLogs = [];
        out = await R.record({ lines: { ...changed, panther: ['Go Panthers!'] }, dir, key: KEY, fetchImpl, encode, log: (x) => failLogs.push(x), pace: 0 });
        t.ok('a refused line is counted, not recorded, and the error is scrubbed of the key', out.failed === 1 && out.done === 0 && !failLogs.join('\n').includes(KEY) && !(await R.readManifest(dir)).lines.panther['Go Panthers!']);
        mode = 'ok';
        out = await R.record({ lines: { jarvis: lines.jarvis.slice(0, 6), matrix: [], panther: [] }, dir, key: KEY, fetchImpl, encode, log: () => {}, pace: 0, limit: 2 });
        t.eq('--limit caps one run', out.done, 2);
        out = await R.record({ lines: { jarvis: lines.jarvis.slice(0, 6), matrix: [], panther: [] }, dir, key: KEY, fetchImpl, encode, log: () => {}, pace: 0, maxMb: 0 });
        t.eq('--max-mb stops it before the recordings grow past the cap', out.done, 0);
        models = ['gemini-3.5-flash'];
        threw = null;
        try { await R.record({ lines: { jarvis: ['Hello there.'], matrix: [], panther: [] }, dir, key: KEY, fetchImpl, encode, log: () => {}, pace: 0 }); } catch (e) { threw = e.message; }
        t.ok('no text-to-speech model in the live list: it stops, with no name trusted from memory', /no text-to-speech model/.test(threw || ''));
        const mft = await readFile(join(dir, 'manifest.json'), 'utf8');
        const env = await openDom(page.html, 'https://jarvis.test/jarvis-test.html', quiet);
        const list = env.window.__jarvis.voiceManifest(JSON.parse(mft));
        t.eq('…every entry it wrote is one the page reads', list.jarvis.size + list.matrix.size + list.panther.size, Object.values(JSON.parse(mft).lines).reduce((n, L) => n + Object.keys(L).length, 0));
        env.close();
    } finally { await rm(dir, { recursive: true, force: true }); }

    t.section('The workflow');
    const wf = await readFile(ROOT + '.github/workflows/jarvis-voice.yml', 'utf8');
    t.ok('run by hand only: workflow_dispatch, no schedule, no push trigger', /\non:\n {2}workflow_dispatch:/.test(wf) && !/schedule:|\n {2}push:|pull_request/.test(wf));
    t.ok('a dry run by default', /default: dry-run/.test(wf));
    t.ok('the dry run always runs first, before recording', wf.indexOf('name: Dry run') > 0 && wf.indexOf('name: Dry run') < wf.indexOf('name: Record'));
    t.eq('the key is read in exactly one place', (wf.match(/secrets\.GEMINI_API_KEY/g) || []).length, 1);
    const recordStep = wf.slice(wf.indexOf('- name: Record'), wf.indexOf('- name: Commit'));
    t.ok('…the Record step\'s environment, which only runs for "record"', recordStep.includes('GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}') && /if: inputs\.mode == 'record'/.test(recordStep));
    t.ok('no input goes straight into a shell line (it passes through the environment)', !/run:[^\n]*\$\{\{\s*inputs\./.test(wf) && !/\n\s+[^#\n]*node [^\n]*\$\{\{/.test(wf));
    t.ok('no token left in git config while recording (persist-credentials: false)', /persist-credentials: false/.test(wf));
    t.ok('actions pinned to a commit, as the knowledge pack\'s are', (wf.match(/uses: [^@\n]+@[0-9a-f]{40}/g) || []).length === 2 && !/uses: [^@\n]+@v\d/.test(wf));
    t.ok('commits as github-actions[bot], only jarvis/voice', /user\.email '41898282\+github-actions\[bot\]@users\.noreply\.github\.com'/.test(wf) && /git add -A jarvis\/voice\n/.test(wf));
    t.ok('the commit message is fixed: no line\'s words in it', /git commit -m 'J\.A\.R\.V\.I\.S\.: record his voice'/.test(wf));
}
