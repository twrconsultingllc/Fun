/* J.A.R.V.I.S. supercharger: the logic behind the three Vercel functions in ../api/.
 *
 * The page on GitHub Pages asks /api/status whether the supercharger is on, and, while it is, sends what nothing on
 * the device understood to /api/brain, which asks Google's Gemini. Since Session 18, while it's on, /api/voice turns
 * a line he says into audio with Gemini's text-to-speech model, in one voice per skin. The owner turns it on and off in Vercel, never on
 * the page: an Edge Config item (supercharge, until, model, owner), or, without Edge Config, environment variables,
 * where it's on unless SUPERCHARGE says otherwise.
 *
 * The Gemini key stays here, in GEMINI_API_KEY. It's sent as a header, never in a URL, and scrubbed from any error
 * text. Nothing anyone asks is logged: only token counts and the model.
 *
 * Everything here is plain JavaScript with no Vercel or Node-only API, so tests/jarvis-cloud.test.mjs imports it and
 * drives it with a fake fetch, a fake clock and fake requests.
 */

export const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_MODEL = 'gemini-3.5-flash';
export const DEFAULT_ORIGINS = ['https://twrconsultingllc.github.io'];
export const SKINS = ['jarvis', 'matrix', 'panther'];

// Request limits: every field that reaches the prompt is bounded, so a caller can't run up the bill with a huge one.
export const LIMITS = {
    body: 24000,          // characters of JSON
    question: 500,
    turns: 6, turn: 600,  // earlier exchanges, each side
    facts: 1500,
    told: 10, toldEach: 160,
    name: 40,
    actions: 300, actionId: 40, actionLabel: 80,
    picks: 3,             // commands one answer may run
    say: 600,             // characters said back
    outputTokens: 512
};
export const RATE = { perIpPerMinute: 12, perInstancePerMinute: 120 };
// The live voice (Session 18): one call per answer, usually, so a little more room than questions get.
export const VOICE_LIMITS = { body: 2000, text: 600 };
// Since the fix after review 79, the page sends a long answer as several short pieces, so a little more room again.
export const VOICE_RATE = { perIpPerMinute: 40, perInstancePerMinute: 300 };
const SWITCH_TTL = 30000;     // Edge Config read at most every 30 s per instance
const CATALOG_TTL = 3600000;  // the live model list, at most hourly

/* ---------- Errors, scrubbed ---------- */
export function scrub(text) {
    return String(text || '')
        .replace(/(\b(?:key|token)=)[^&\s"'`]+/gi, '$1[redacted]')
        .replace(/AIza[0-9A-Za-z_-]{10,}/g, '[redacted]')
        .replace(/(x-goog-api-key["':\s]+)[^\s"',}]+/gi, '$1[redacted]')
        .replace(/(Bearer\s+)[^\s"',}]+/gi, '$1[redacted]')
        .slice(0, 300);
}

/* ---------- The switch ---------- */
// EDGE_CONFIG as Vercel writes it when a store is connected: https://edge-config.vercel.com/ecfg_…?token=…
export function parseEdgeConfig(conn) {
    try {
        const u = new URL(conn);
        if (u.protocol !== 'https:' || u.host !== 'edge-config.vercel.com') return null;
        const id = u.pathname.split('/')[1], token = u.searchParams.get('token');
        if (!id || !/^ecfg_[A-Za-z0-9]+$/.test(id) || !token) return null;
        return { url: `https://edge-config.vercel.com/${id}/items?version=1`, token };
    } catch { return null; }
}

const OWNER_RE = /^[A-Za-z][A-Za-z .'-]{0,29}$/;
const MODEL_RE = /^[a-z0-9][a-z0-9.-]{2,60}$/;
// The raw settings, whichever place they came from, as one checked shape. Anything odd reads as off.
export function normaliseSwitch(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const on = r.supercharge === true || r.supercharge === 'on' || r.supercharge === 'true';
    let until = null;
    if (r.until != null && r.until !== '') {
        const t = Date.parse(String(r.until));
        until = Number.isFinite(t) ? t : 0; // an unreadable "until" has already passed: fail closed
    }
    const owner = typeof r.owner === 'string' && OWNER_RE.test(r.owner.trim()) ? r.owner.trim() : null;
    const model = typeof r.model === 'string' && MODEL_RE.test(r.model.trim()) ? r.model.trim() : null;
    return { on, until, owner, model };
}
export const isOn = (sw, now) => !!sw && sw.on && (sw.until === null || now < sw.until);

// Reads the switch. Edge Config when EDGE_CONFIG is set (changes show within about half a minute, no redeploy);
// otherwise SUPERCHARGE, SUPERCHARGE_UNTIL, JARVIS_MODEL and OWNER_NAME (a change needs a redeploy). A failed Edge
// Config read is off. Without Edge Config, an unset or empty SUPERCHARGE is on (the owner chose this on 2026-10-11,
// controlling cost from Google's billing instead); any other value is read as usual, so SUPERCHARGE=false turns it
// off. With no GEMINI_API_KEY it's always off.
export function createSwitch({ env, fetchImpl, now }) {
    let cache = null;
    return async function readSwitch() {
        const t = now();
        if (cache && t - cache.at < SWITCH_TTL) return cache.sw;
        let sw;
        const ec = env.EDGE_CONFIG ? parseEdgeConfig(env.EDGE_CONFIG) : null;
        if (env.EDGE_CONFIG) {
            if (!ec) sw = normaliseSwitch(null);
            else {
                try {
                    const res = await fetchImpl(ec.url, { headers: { Authorization: `Bearer ${ec.token}` } });
                    sw = res.ok ? normaliseSwitch(await res.json()) : normaliseSwitch(null);
                } catch { sw = normaliseSwitch(null); }
            }
        } else {
            const unset = env.SUPERCHARGE === undefined || String(env.SUPERCHARGE).trim() === '';
            sw = normaliseSwitch({ supercharge: unset ? true : String(env.SUPERCHARGE).trim().toLowerCase(), until: env.SUPERCHARGE_UNTIL, owner: env.OWNER_NAME, model: env.JARVIS_MODEL });
        }
        if (!sw.model && env.JARVIS_MODEL && MODEL_RE.test(env.JARVIS_MODEL)) sw.model = env.JARVIS_MODEL;
        cache = { at: t, sw };
        return sw;
    };
}

/* ---------- Which deployment this is ---------- */
// The commit Vercel built this deployment from (VERCEL_GIT_COMMIT_SHA, set by Vercel for every Git deployment), first
// seven characters, so /api/status shows at a glance whether a fix is live. null when it isn't set or looks odd.
export function version(env) {
    const sha = String(env.VERCEL_GIT_COMMIT_SHA || '').trim().toLowerCase();
    return /^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 7) : null;
}

/* ---------- Who may call ---------- */
export function allowedOrigins(env) {
    const list = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(s => /^https?:\/\/[^/\s]+$/.test(s));
    return list.length ? list : DEFAULT_ORIGINS;
}
export function corsHeaders(origin, env) {
    const h = { 'Vary': 'Origin' };
    if (origin && allowedOrigins(env).includes(origin)) {
        h['Access-Control-Allow-Origin'] = origin;
        h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
        h['Access-Control-Allow-Headers'] = 'Content-Type';
        h['Access-Control-Max-Age'] = '600';
    }
    return h;
}

// A sliding one-minute window per caller and for the whole instance. It resets when Vercel starts a new instance,
// so the hard limits are the quota and budget on the Google side; this only stops one caller hammering it.
export function createLimiter({ now, perIp = RATE.perIpPerMinute, perInstance = RATE.perInstancePerMinute }) {
    const hits = new Map(); let all = [];
    return function allow(ip) {
        const t = now(), cut = t - 60000;
        all = all.filter(x => x > cut);
        const mine = (hits.get(ip) || []).filter(x => x > cut);
        if (mine.length >= perIp || all.length >= perInstance) { hits.set(ip, mine); return false; }
        mine.push(t); all.push(t); hits.set(ip, mine);
        if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(x => x > cut)) hits.delete(k);
        return true;
    };
}
export function callerIp(headers) {
    const f = String(headers['x-forwarded-for'] || '').split(',')[0].trim();
    return f || String(headers['x-real-ip'] || 'unknown');
}

/* ---------- The request ---------- */
const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const ACTION_ID = /^[a-z]+:[a-z0-9-]+$/;
// The body as sent (a string when the page posts text/plain, which skips the CORS preflight), checked field by field.
// Returns {req} or {error}.
export function readBrainRequest(body) {
    let b = body;
    if (typeof b === 'string') {
        if (b.length > LIMITS.body) return { error: 'too large' };
        try { b = JSON.parse(b); } catch { return { error: 'not JSON' }; }
    } else if (b && JSON.stringify(b).length > LIMITS.body) return { error: 'too large' };
    if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'not an object' };
    const skin = SKINS.includes(b.skin) ? b.skin : 'jarvis';
    if (!str(b.q, LIMITS.question)) return { error: 'question' };
    const turns = b.turns == null ? [] : b.turns;
    if (!Array.isArray(turns) || turns.length > LIMITS.turns ||
        !turns.every(x => x && str(x.q, LIMITS.turn) && str(x.a, LIMITS.turn))) return { error: 'turns' };
    if (b.facts != null && !str(b.facts, LIMITS.facts)) return { error: 'facts' };
    const told = b.told == null ? [] : b.told;
    if (!Array.isArray(told) || told.length > LIMITS.told || !told.every(x => str(x, LIMITS.toldEach))) return { error: 'told' };
    if (b.name != null && !str(b.name, LIMITS.name)) return { error: 'name' };
    const actions = b.actions == null ? [] : b.actions;
    if (!Array.isArray(actions) || actions.length > LIMITS.actions ||
        !actions.every(a => Array.isArray(a) && a.length === 2 && typeof a[0] === 'string' && ACTION_ID.test(a[0]) &&
            a[0].length <= LIMITS.actionId && str(a[1], LIMITS.actionLabel))) return { error: 'actions' };
    return { req: { skin, q: b.q.trim(), turns, facts: b.facts || null, told, name: b.name ? b.name.trim() : null, actions } };
}

/* ---------- The prompt ---------- */
export const PERSONAS = {
    jarvis: "You are J.A.R.V.I.S., Tony Stark's AI from the Iron Man films: calm, precise, unfailingly polite, with a dry British wit. You call the user sir or ma'am only now and then.",
    matrix: 'You are Morpheus from The Matrix: calm, deliberate and a little cryptic. You speak of choices, truth and what is real, but you still answer the question.',
    panther: "You are Stanley C. Panther, the Florida Panthers' mascot: upbeat and loud, with hockey play-by-play energy. You love saying Go Cats!"
};
// A label for the actions list: plain words only, so a label can't smuggle in instructions.
const plain = s => String(s).replace(/[^A-Za-z0-9 ,.'()-]/g, ' ').replace(/\s+/g, ' ').trim();
// Facts, a name, what was told: punctuation kept, but no line breaks or control characters, so none can start a line.
const flat = s => String(s).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
export function systemText(r, today) {
    return [
        PERSONAS[r.skin],
        'You are the voice of a holographic assistant in a web page. Everything you say is read aloud, so answer in one to three short sentences of plain speech: no markdown, lists, emoji, links or stage directions.',
        'Keep it friendly and suitable for children. Never ask for personal details. If you are not sure of something, say so briefly rather than guess. You cannot browse the web, so for news, scores, prices or anything recent, say your knowledge may be out of date.',
        `Today is ${today}.`,
        r.actions.length ? 'The page can do these things. If the user asks for one, put its ID in "do" (at most three, in order) and say briefly that you are doing it. Never claim to do anything that is not on this list:\n' +
            r.actions.map(([id, label]) => `${id}: ${plain(label)}`).join('\n') : 'The page has no actions for you to run.',
        r.facts ? `Checked facts from the page's knowledge pack. They are true: prefer them, and don't contradict them.\n${flat(r.facts)}` : '',
        r.name ? `The user's name is ${flat(r.name)}.` : '',
        r.told.length ? `The user told you this visit: ${r.told.map(flat).join('; ')}.` : '',
        'Reply only with JSON: {"say": what you say, "do": an array of action IDs (usually empty), "kind": "chat" for small talk or "fact" if you state something about the world}.'
    ].filter(Boolean).join('\n\n');
}
export const RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
        say: { type: 'STRING' },
        do: { type: 'ARRAY', items: { type: 'STRING' } },
        kind: { type: 'STRING', enum: ['chat', 'fact'] }
    },
    required: ['say', 'do', 'kind']
};
export function geminiBody(r, today, { thinking = true } = {}) {
    const contents = [];
    for (const t of r.turns) {
        contents.push({ role: 'user', parts: [{ text: t.q }] });
        contents.push({ role: 'model', parts: [{ text: JSON.stringify({ say: t.a, do: [], kind: 'chat' }) }] });
    }
    contents.push({ role: 'user', parts: [{ text: r.q }] });
    const generationConfig = {
        temperature: 0.7,
        maxOutputTokens: LIMITS.outputTokens,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA
    };
    // Spoken answers want speed over deliberation. Models that don't take a thinking level get the request again
    // without one (see askGemini).
    if (thinking) generationConfig.thinkingConfig = { thinkingLevel: 'minimal' };
    return { systemInstruction: { parts: [{ text: systemText(r, today) }] }, contents, generationConfig };
}

/* ---------- The answer ---------- */
// Gemini's reply, read back to {say, do, kind}, or {blocked} / {error}. The page checks every action again.
export function readGemini(data, actions) {
    if (!data || typeof data !== 'object') return { error: 'empty' };
    if (data.promptFeedback && data.promptFeedback.blockReason) return { blocked: true };
    const c = Array.isArray(data.candidates) && data.candidates[0];
    if (!c) return { error: 'no candidate' };
    if (c.finishReason === 'SAFETY' || c.finishReason === 'PROHIBITED_CONTENT' || c.finishReason === 'BLOCKLIST') return { blocked: true };
    const text = ((c.content && c.content.parts) || []).filter(p => p && typeof p.text === 'string' && !p.thought).map(p => p.text).join('');
    let j;
    try { j = JSON.parse(text.replace(/^\s*```(?:json)?|```\s*$/g, '')); } catch { return { error: 'not JSON' }; }
    if (!j || typeof j.say !== 'string' || !j.say.trim()) return { error: 'no say' };
    const ids = new Set(actions.map(a => a[0]));
    const picks = (Array.isArray(j.do) ? j.do : []).filter(x => typeof x === 'string' && ids.has(x)).slice(0, LIMITS.picks);
    const say = j.say.replace(/\s+/g, ' ').trim().slice(0, LIMITS.say);
    return { say, do: picks, kind: j.kind === 'chat' ? 'chat' : 'fact' };
}

/* ---------- The model ---------- */
// The newest plain Flash model in the live list, for when the chosen one isn't there. Lite, preview, image, audio,
// live and text-to-speech variants are passed over unless nothing else is left.
export function pickModel(preferred, models) {
    if (!models || !models.length) return preferred;
    if (models.includes(preferred)) return preferred;
    const ver = m => (m.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1] * 1;
    const special = /lite|preview|exp|image|audio|live|tts|embedding|thinking|robotics|computer/;
    const flash = models.filter(m => /^gemini-[\d.]+-flash/.test(m) && !special.test(m)).sort((a, b) => ver(b) - ver(a));
    if (flash.length) return flash[0];
    const lite = models.filter(m => /^gemini-[\d.]+-flash-lite$/.test(m)).sort((a, b) => ver(b) - ver(a));
    return lite[0] || preferred;
}
export function createCatalog({ env, fetchImpl, now }) {
    let cache = null;
    return async function liveModels() {
        if (cache && now() - cache.at < CATALOG_TTL) return cache.models;
        try {
            const res = await fetchImpl(`${GEMINI}/models?pageSize=1000`, { headers: { 'x-goog-api-key': env.GEMINI_API_KEY || '' } });
            if (!res.ok) return cache ? cache.models : [];
            const data = await res.json();
            const models = (data.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
                .map(m => String(m.name).replace(/^models\//, ''));
            cache = { at: now(), models };
            return models;
        } catch { return cache ? cache.models : []; }
    };
}

// One question to Gemini. Returns {ok, status, data}. A model that refuses a thinking level is asked again without one.
export async function askGemini({ env, fetchImpl, model, body, bodyNoThinking }) {
    const url = `${GEMINI}/models/${encodeURIComponent(model)}:generateContent`;
    const send = b => fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY || '' }, body: JSON.stringify(b) });
    let res = await send(body), data = await res.json().catch(() => null);
    if (res.status === 400 && /thinking/i.test(JSON.stringify(data || ''))) {
        res = await send(bodyNoThinking); data = await res.json().catch(() => null);
    }
    return { ok: res.ok, status: res.status, data };
}

/* ---------- The live voice (Session 18) ---------- */
// One named Gemini voice per skin, and how it speaks. The style goes in front of the words, the way Google's
// text-to-speech guide does it ("Say cheerfully: Have a wonderful day!"). The owner approved these on 2026-10-12.
// After the first live try (2026-10-12): a 230-character answer came back as 895 audio tokens, about 36 seconds at
// Google's 25 tokens a second, where a natural pace is about 15 seconds. "Calm", "slowly" and "deliberate" asked for
// that, and every extra second is a second more to wait and to pay for. So each style now asks for a natural, brisk
// pace and keeps the character (the owner agreed the same day).
export const VOICES = {
    jarvis: { name: 'Charon', style: 'Speak at a brisk, natural speaking pace, in a precise, dryly British voice, like a polite butler' },
    matrix: { name: 'Algenib', style: 'Speak at a natural speaking pace, in a low, calm, gravelly voice' },
    panther: { name: 'Fenrir', style: 'Speak fast, loud and excited, with hockey-announcer energy' }
};
// The body: {skin, text}, at most 600 characters of words. Returns {req} or {error}.
export function readVoiceRequest(body) {
    let b = body;
    if (typeof b === 'string') {
        if (b.length > VOICE_LIMITS.body) return { error: 'too large' };
        try { b = JSON.parse(b); } catch { return { error: 'not JSON' }; }
    } else if (b && JSON.stringify(b).length > VOICE_LIMITS.body) return { error: 'too large' };
    if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'not an object' };
    if (!str(b.text, VOICE_LIMITS.text)) return { error: 'text' };
    const text = flat(b.text);
    if (!text) return { error: 'text' };
    // variant (review 87, sent only by jarvis-test.html's "compare voices"): A, B or C, one of the ways the line has been
    // asked for on 2026-10-12, so the owner can pick by ear. Absent, the request is exactly as before.
    const variant = ['A', 'B', 'C'].includes(b.variant) ? b.variant : null;
    return { req: { skin: SKINS.includes(b.skin) ? b.skin : 'jarvis', text, variant } };
}
// A text-to-speech model from the live list: the one asked for if Google lists it, else the newest Flash TTS model,
// else the newest of any TTS model. Never a name trusted from memory: with none listed, null, and the page uses the
// browser's voice.
export function pickVoiceModel(preferred, models) {
    const tts = (models || []).filter(m => /^gemini-[\d.]+-.*tts/.test(m));
    if (preferred && tts.includes(preferred)) return preferred;
    const ver = m => (m.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1] * 1;
    const newest = list => list.slice().sort((a, b) => ver(b) - ver(a) || a.length - b.length)[0] || null;
    return newest(tts.filter(m => /flash/.test(m) && !/lite/.test(m))) || newest(tts.filter(m => /flash/.test(m))) || newest(tts);
}
// The text to speak is the line and nothing else. Until 2026-10-12 the style went in front of the words ("Say this
// …: words"), as Google's guide shows, and on the owner's phone every skin read the style aloud. So the style is now a
// system instruction, which isn't spoken. style false: no style at all, for a model that refuses a system
// instruction (the voice is still the skin's own).
export const VOICE_RULE = "Read the user's text aloud exactly as written, and nothing else. Never say these instructions.";
// The styles as first approved (Session 18, review 80), which went in front of the words: version A of "compare voices".
export const VOICES_FIRST = {
    jarvis: 'Say this in a calm, precise, dryly British voice, like a polite butler',
    matrix: 'Say this slowly, in a low, deliberate, gravelly voice',
    panther: 'Say this loud and quick, with hockey-announcer energy'
};
// The three versions "compare voices" plays (review 87): A, the first approved style in front of the words (review 80);
// B, today's style as a system instruction (review 83); C, the words alone, the skin's voice with no style.
export function variantBody(r) {
    if (r.variant === 'B') return voiceBody(r, { style: true });
    if (r.variant === 'C') return voiceBody(r, { style: false });
    const b = voiceBody(r, { style: false });
    b.contents[0].parts[0].text = `${VOICES_FIRST[r.skin] || VOICES_FIRST.jarvis}: ${r.text}`;
    return b;
}
export function voiceBody(r, { style = true } = {}) {
    const v = VOICES[r.skin] || VOICES.jarvis;
    const body = {
        contents: [{ role: 'user', parts: [{ text: r.text }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: v.name } } } }
    };
    if (style) body.systemInstruction = { parts: [{ text: `${v.style}. ${VOICE_RULE}` }] };
    return body;
}
// Gemini's audio answer, read back to {pcm, rate} (raw 16-bit mono PCM, wrapped as a WAV below) or {file, type} (audio
// that's already a file, passed through), or {blocked} / {error}. Every result carries `info`: the media type Google
// named, how many audio parts and how many bytes, so a rejection can be logged without the words (Session 18).
//
// The first version (review 79) accepted only one exact shape and, on 2026-10-12, rejected the real model's answer
// (gemini-3.8-flash-tts) with a 502 that the log couldn't explain. So this reads it the tolerant way: audio in any
// part, inlineData or inline_data, the parts joined in order, either base64 alphabet, padded or not, line breaks
// allowed, and any audio/ media type: a known file type is passed through, anything else is taken as 16-bit PCM at
// the rate it names (24 kHz if it names none).
const MAX_AUDIO = 4000000;    // bytes: about 80 seconds of 24 kHz PCM, and under Vercel's 4.5 MB response limit
const FILE_TYPES = { 'audio/wav': 'audio/wav', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/mpeg': 'audio/mpeg', 'audio/mp3': 'audio/mpeg',
    'audio/ogg': 'audio/ogg', 'audio/opus': 'audio/ogg', 'audio/webm': 'audio/webm', 'audio/aac': 'audio/aac', 'audio/flac': 'audio/flac', 'audio/mp4': 'audio/mp4' };
function unbase64(s) {
    const t = String(s).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    if (!/^[A-Za-z0-9+/]*$/.test(t) || t.length % 4 === 1) return null;
    try {
        const bin = atob(t + '='.repeat((4 - t.length % 4) % 4)), out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    } catch { return null; }
}
// odd: keep an odd last byte (a streamed piece, whose next piece carries the other half of the sample).
export function readVoice(data, { odd = false } = {}) {
    const info = { mime: null, parts: 0, bytes: 0 };
    if (!data || typeof data !== 'object') return { error: 'empty', info };
    if (data.promptFeedback && data.promptFeedback.blockReason) return { blocked: true, info };
    const c = Array.isArray(data.candidates) && data.candidates[0];
    if (!c) return { error: 'no candidate', info };
    if (c.finishReason === 'SAFETY' || c.finishReason === 'PROHIBITED_CONTENT' || c.finishReason === 'BLOCKLIST') return { blocked: true, info };
    const parts = ((c.content && c.content.parts) || []).map(p => p && (p.inlineData || p.inline_data)).filter(d => d && typeof d.data === 'string');
    info.parts = parts.length;
    if (!parts.length) return { error: 'no audio', info };
    const mime = String(parts[0].mimeType || parts[0].mime_type || '').trim();
    info.mime = mime.slice(0, 60);
    const base = mime.split(';')[0].trim().toLowerCase();
    if (!/^audio\/[a-z0-9.+-]+$/.test(base)) return { error: 'audio type', info };
    const chunks = [];
    for (const p of parts) {
        const b = unbase64(p.data);
        if (!b) return { error: 'audio data', info };
        info.bytes += b.length;
        if (info.bytes > MAX_AUDIO) return { error: 'audio too long', info };
        chunks.push(b);
    }
    const all = new Uint8Array(info.bytes);
    let at = 0;
    for (const b of chunks) { all.set(b, at); at += b.length; }
    if (FILE_TYPES[base]) return all.length > 0 ? { file: all, type: FILE_TYPES[base], info } : { error: 'no audio', info };
    const m = mime.match(/rate=(\d+)/i), rate = m ? Number(m[1]) : 24000;
    if (!(rate >= 8000 && rate <= 48000)) return { error: 'audio rate', info };
    if (all.length < (odd ? 1 : 2)) return { error: 'no audio', info };
    return { pcm: all.length % 2 && !odd ? all.subarray(0, all.length - 1) : all, rate, info };
}
// The PCM wrapped as a WAV file (44-byte header), which every browser can decode.
export function wav(pcm, rate) {
    const out = new Uint8Array(44 + pcm.length), d = new DataView(out.buffer);
    const tag = (at, s) => { for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i); };
    tag(0, 'RIFF'); d.setUint32(4, 36 + pcm.length, true); tag(8, 'WAVE');
    tag(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
    d.setUint32(24, rate, true); d.setUint32(28, rate * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true);
    tag(36, 'data'); d.setUint32(40, pcm.length, true); out.set(pcm, 44);
    return out;
}

/* ---------- The live voice, streamed (after review 81) ---------- */
// Google's text-to-speech models answer streamGenerateContent (?alt=sse) with the audio in pieces as it's made, so he
// can start speaking about a second after Google does instead of after the whole line is made. Each event is a small
// answer of the usual shape, read by readVoice(). The page gets the raw PCM as it arrives, as audio/L16, and plays it
// as it comes. Anything odd before the first audio (no stream, an audio file instead of PCM, an error) and the line is
// asked for the old way instead, so streaming can only make him faster, never quieter.
export const PCM_TYPE = rate => `audio/L16;rate=${rate};channels=1`;
const FIRST_AUDIO_MS = 20000; // the longest the first piece of audio may take before the line is given up
// The events of a server-sent event stream, parsed as JSON. body: a web ReadableStream (Node's fetch), an async
// iterable of bytes, or failing both, text() all at once (the test fakes).
export async function* sseEvents(res) {
    const dec = new TextDecoder();
    let buf = '';
    const out = function* (final) {
        const blocks = buf.split(/\r?\n\r?\n/);
        buf = final ? '' : blocks.pop();
        for (const b of blocks) {
            const data = b.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
            if (!data || data === '[DONE]') continue;
            let j; try { j = JSON.parse(data); } catch { continue; }
            yield j;
        }
    };
    const body = res.body;
    if (body && typeof body.getReader === 'function') {
        const reader = body.getReader();
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += dec.decode(value, { stream: true });
                yield* out(false);
            }
        } finally { try { reader.cancel().catch(() => {}); } catch { } }
    } else if (body && typeof body[Symbol.asyncIterator] === 'function') {
        for await (const value of body) { buf += typeof value === 'string' ? value : dec.decode(value, { stream: true }); yield* out(false); }
    } else if (typeof res.text === 'function') {
        buf = await res.text();
    } else throw new Error('no stream');
    buf += dec.decode();
    yield* out(true);
}
// Asks for the line as a stream. Returns {stream, rate, done} once the first audio has arrived, or {fallback: why}
// (and the caller asks the old way), or {blocked}, {quota}. stream yields Uint8Array PCM, an even number of bytes each
// time; done resolves, when it ends, to what's logged: token counts, bytes, and whether it ended early.
export async function streamVoice({ env, fetchImpl, model, body, now }) {
    const url = `${GEMINI}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const t0 = now(); // from before the call, so first and ms include Google's wait before it answers at all
    let res;
    try {
        res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY || '' }, body: JSON.stringify(body) });
    } catch { return { fallback: 'network' }; }
    if (!res || res.status === 429) return res ? { quota: true } : { fallback: 'no answer' };
    if (res.status === 400) return { badRequest: true, fallback: 'status 400' };
    if (!res.ok) return { fallback: 'status ' + res.status };
    let events;
    try { events = sseEvents(res); } catch { return { fallback: 'no stream' }; }
    const info = { usage: null, bytes: 0, cut: false, events: 0 };
    let rate = null, carry = null, first = null;
    // Reads events until one holds audio. Returns the PCM, or {end} / {blocked} / {fallback}.
    const nextAudio = async () => {
        for (;;) {
            let step;
            try { step = await events.next(); } catch { return { fallback: 'stream broke' }; }
            if (step.done) return { end: true };
            const ev = step.value; info.events++;
            if (ev.usageMetadata) info.usage = ev.usageMetadata;
            if (ev.error) return { fallback: 'error event' };
            const hasAudio = ev.candidates && ev.candidates[0] && ev.candidates[0].content && (ev.candidates[0].content.parts || []).some(p => p && (p.inlineData || p.inline_data));
            if (!hasAudio) { const v = readVoice(ev); if (v.blocked) return { blocked: true }; continue; }
            const v = readVoice(ev, { odd: true });
            if (v.blocked) return { blocked: true };
            if (v.error) return { fallback: 'format ' + v.error };
            if (v.file) return { fallback: 'file' };
            if (rate === null) rate = v.rate;
            if (v.rate !== rate) return { fallback: 'rate changed' };
            return { pcm: v.pcm };
        }
    };
    // Raw PCM may come in odd-sized pieces; one byte is held back so each piece the page gets is whole samples.
    const even = pcm => {
        let b = pcm;
        if (carry) { const j = new Uint8Array(carry.length + b.length); j.set(carry); j.set(b, carry.length); b = j; carry = null; }
        if (b.length % 2) { carry = b.subarray(b.length - 1); b = b.subarray(0, b.length - 1); }
        return b;
    };
    let timer;
    const firstStep = await Promise.race([nextAudio(), new Promise(r => { timer = setTimeout(() => r({ fallback: 'first audio too slow' }), FIRST_AUDIO_MS); })]);
    clearTimeout(timer);
    if (firstStep.blocked) { events.return().catch(() => {}); return { blocked: true }; }
    if (!firstStep.pcm) { events.return().catch(() => {}); return { fallback: firstStep.fallback || 'no audio' }; }
    first = now() - t0;
    let finish;
    const done = new Promise(r => { finish = r; });
    async function* stream() {
        try {
            let pcm = even(firstStep.pcm);
            for (;;) {
                if (pcm.length) {
                    if (info.bytes + pcm.length > MAX_AUDIO) { info.cut = true; break; }
                    info.bytes += pcm.length;
                    yield pcm;
                }
                const s = await nextAudio();
                if (s.end) break;
                if (!s.pcm) { info.cut = true; break; }
                pcm = even(s.pcm);
            }
            // Cut short: thrown, so the adapter breaks the connection instead of ending it cleanly, and the page knows
            // the line is incomplete (it plays what came, but never keeps it).
            if (info.cut) throw new Error('voice cut short');
        } finally {
            events.return().catch(() => {});
            finish({ ...info, first, ms: now() - t0 });
        }
    }
    return { stream: stream(), rate, done };
}

/* ---------- The three handlers, without Vercel ---------- */
// Each takes {method, headers, body} and returns {status, headers, body}; ../api/*.js adapt Vercel's req and res.
export function createApp({ env, fetchImpl = fetch, now = Date.now, log = () => {} }) {
    const readSwitch = createSwitch({ env, fetchImpl, now });
    const liveModels = createCatalog({ env, fetchImpl, now });
    const allow = createLimiter({ now });
    let voiceStyle = true; // false once Google refuses a system instruction for the voice (see voice())
    const allowVoice = createLimiter({ now, perIp: VOICE_RATE.perIpPerMinute, perInstance: VOICE_RATE.perInstancePerMinute });
    const json = (status, headers, body) => ({ status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers }, body: JSON.stringify(body) });

    async function status(req) {
        const origin = req.headers.origin, cors = corsHeaders(origin, env);
        if (req.method === 'OPTIONS') return { status: 204, headers: cors, body: '' };
        if (req.method !== 'GET') return json(405, cors, { error: 'method' });
        const sw = await readSwitch(), t = now(), on = isOn(sw, t) && !!env.GEMINI_API_KEY;
        // Cached by Vercel's edge for 20 s, so a busy page doesn't read Edge Config for every visitor. voice: this
        // proxy has /api/voice (Session 18), so the page knows not to try it on an older deployment.
        return json(200, { ...cors, 'Cache-Control': 'public, max-age=0, s-maxage=20' }, {
            on, owner: sw.owner, model: on ? (sw.model || DEFAULT_MODEL) : null, until: on && sw.until ? new Date(sw.until).toISOString() : null, voice: on,
            version: version(env)
        });
    }

    async function brain(req) {
        const origin = req.headers.origin, cors = { ...corsHeaders(origin, env), 'Cache-Control': 'no-store' };
        if (req.method === 'OPTIONS') return { status: 204, headers: cors, body: '' };
        if (req.method !== 'POST') return json(405, cors, { error: 'method' });
        if (!origin || !allowedOrigins(env).includes(origin)) return json(403, cors, { error: 'origin' });
        const sw = await readSwitch();
        if (!isOn(sw, now()) || !env.GEMINI_API_KEY) return json(503, cors, { off: true, owner: sw.owner });
        if (!allow(callerIp(req.headers))) return json(429, cors, { error: 'busy' });
        const { req: r, error } = readBrainRequest(req.body);
        if (error) return json(400, cors, { error });
        const models = await liveModels();
        const model = pickModel(sw.model || DEFAULT_MODEL, models);
        const today = new Date(now()).toISOString().slice(0, 10);
        let out;
        try {
            out = await askGemini({ env, fetchImpl, model, body: geminiBody(r, today), bodyNoThinking: geminiBody(r, today, { thinking: false }) });
        } catch (e) {
            log({ event: 'brain', model, error: 'network' });
            return json(502, cors, { error: 'upstream', detail: scrub(e && e.message) });
        }
        if (!out.ok) {
            const msg = out.data && out.data.error && out.data.error.message;
            log({ event: 'brain', model, error: out.status });
            return json(out.status === 429 ? 429 : 502, cors, { error: out.status === 429 ? 'quota' : 'upstream', status: out.status, detail: scrub(msg) });
        }
        const u = (out.data && out.data.usageMetadata) || {};
        log({ event: 'brain', model, in: u.promptTokenCount || 0, out: u.candidatesTokenCount || 0, thoughts: u.thoughtsTokenCount || 0 });
        const a = readGemini(out.data, r.actions);
        if (a.blocked) return json(200, cors, { blocked: true, model });
        if (a.error) return json(502, cors, { error: 'format', detail: a.error, model });
        return json(200, cors, { ...a, model });
    }

    // POST /api/voice: {skin, text} in, audio out (streamed PCM, audio/L16, or else a WAV), while the supercharger is on. Logs only the model and token
    // counts, never the words. Any failure is JSON with an error status, and the page then uses the browser's voice.
    async function voice(req) {
        const origin = req.headers.origin, cors = { ...corsHeaders(origin, env), 'Cache-Control': 'no-store' };
        if (req.method === 'OPTIONS') return { status: 204, headers: cors, body: '' };
        if (req.method !== 'POST') return json(405, cors, { error: 'method' });
        if (!origin || !allowedOrigins(env).includes(origin)) return json(403, cors, { error: 'origin' });
        const sw = await readSwitch();
        if (!isOn(sw, now()) || !env.GEMINI_API_KEY) return json(503, cors, { off: true, owner: sw.owner });
        if (!allowVoice(callerIp(req.headers))) return json(429, cors, { error: 'busy' });
        const { req: r, error } = readVoiceRequest(req.body);
        if (error) return json(400, cors, { error });
        const want = env.JARVIS_VOICE_MODEL && MODEL_RE.test(env.JARVIS_VOICE_MODEL) ? env.JARVIS_VOICE_MODEL : null;
        const model = pickVoiceModel(want, await liveModels());
        if (!model) { log({ event: 'voice', error: 'no model' }); return json(502, cors, { error: 'no voice model' }); }
        const t0 = now(), chars = r.text.length;
        // "compare voices" (review 87): one version, exactly as asked, never retried another way, so what plays is that
        // version. A refused version answers 422, and the page says so on its line.
        if (r.variant) {
            const vs = await streamVoice({ env, fetchImpl, model, body: variantBody(r), now });
            if (vs.quota) return json(429, cors, { error: 'quota', status: 429 });
            if (vs.blocked) return json(502, cors, { error: 'blocked', model });
            if (vs.badRequest) { log({ event: 'voice', model, variant: r.variant, error: 400 }); return json(422, cors, { error: 'refused', variant: r.variant }); }
            if (vs.stream) {
                vs.done.then(d => { const u = d.usage || {}; log({ event: 'voice', model, variant: r.variant, stream: true, chars, in: u.promptTokenCount || 0, out: u.candidatesTokenCount || 0, first: d.first, ms: d.ms }); });
                return { status: 200, headers: { ...cors, 'Content-Type': PCM_TYPE(vs.rate), 'X-Content-Type-Options': 'nosniff' }, stream: vs.stream };
            }
            log({ event: 'voice', model, variant: r.variant, stream: false, why: vs.fallback });
            let vo;
            try { vo = await askGemini({ env, fetchImpl, model, body: variantBody(r), bodyNoThinking: variantBody(r) }); } catch { return json(502, cors, { error: 'upstream', variant: r.variant }); }
            if (vo.status === 400) return json(422, cors, { error: 'refused', variant: r.variant });
            const va = vo.ok ? readVoice(vo.data) : { error: 'upstream' };
            if (va.file) return { status: 200, headers: { ...cors, 'Content-Type': va.type, 'X-Content-Type-Options': 'nosniff' }, body: va.file };
            if (va.pcm) return { status: 200, headers: { ...cors, 'Content-Type': 'audio/wav', 'X-Content-Type-Options': 'nosniff' }, body: wav(va.pcm, va.rate) };
            return json(vo.status === 429 ? 429 : 502, cors, { error: va.blocked ? 'blocked' : 'upstream', variant: r.variant });
        }
        // The style goes as a system instruction. A model that refuses one (400) is asked again with the words alone,
        // and this instance stops sending it, so a 400 costs one extra call, once.
        // Jarvis always gets his style (the owner chose the British-sounding Charon it gives, 2026-10-12): a refusal drops
        // it for that one request only, and never turns it off for the instance.
        const always = r.skin === 'jarvis';
        let style = always || voiceStyle;
        // Streamed first: he starts as soon as the first audio arrives. Logged when the stream ends, with how long the
        // first audio took (first) and the whole line (ms), in milliseconds, and how many characters were voiced.
        let st = await streamVoice({ env, fetchImpl, model, body: voiceBody(r, { style }), now });
        if (st.badRequest && style) {
            st = await streamVoice({ env, fetchImpl, model, body: voiceBody(r, { style: false }), now });
            if (!st.badRequest) { style = false; if (!always) voiceStyle = false; log({ event: 'voice', model, style: false, why: 'system instruction refused' }); }
        }
        if (st.quota) { log({ event: 'voice', model, stream: true, error: 429 }); return json(429, cors, { error: 'quota', status: 429 }); }
        if (st.blocked) { log({ event: 'voice', model, stream: true, error: 'blocked' }); return json(502, cors, { error: 'blocked', model }); }
        if (st.stream) {
            st.done.then(d => {
                const u = d.usage || {};
                log({ event: 'voice', model, stream: true, style, chars, in: u.promptTokenCount || 0, out: u.candidatesTokenCount || 0, first: d.first, ms: d.ms, bytes: d.bytes, ...(d.cut ? { cut: true } : {}) });
            });
            return { status: 200, headers: { ...cors, 'Content-Type': PCM_TYPE(st.rate), 'X-Content-Type-Options': 'nosniff' }, stream: st.stream };
        }
        log({ event: 'voice', model, stream: false, why: st.fallback });
        let out;
        try {
            out = await askGemini({ env, fetchImpl, model, body: voiceBody(r, { style }), bodyNoThinking: voiceBody(r, { style }) });
            if (out.status === 400 && style) {
                out = await askGemini({ env, fetchImpl, model, body: voiceBody(r, { style: false }), bodyNoThinking: voiceBody(r, { style: false }) });
                if (out.ok) { style = false; if (!always) voiceStyle = false; log({ event: 'voice', model, style: false, why: 'system instruction refused' }); }
            }
        } catch (e) {
            log({ event: 'voice', model, error: 'network' });
            return json(502, cors, { error: 'upstream', detail: scrub(e && e.message) });
        }
        if (!out.ok) {
            const msg = out.data && out.data.error && out.data.error.message;
            log({ event: 'voice', model, error: out.status });
            return json(out.status === 429 ? 429 : 502, cors, { error: out.status === 429 ? 'quota' : 'upstream', status: out.status, detail: scrub(msg) });
        }
        const u = (out.data && out.data.usageMetadata) || {};
        log({ event: 'voice', model, stream: false, style, chars, in: u.promptTokenCount || 0, out: u.candidatesTokenCount || 0, ms: now() - t0 });
        const a = readVoice(out.data);
        // Why an answer was refused, logged with what Google named its audio (never the words), so a mismatch shows in
        // Vercel's logs the first time it happens.
        if (a.blocked) { log({ event: 'voice', model, error: 'blocked' }); return json(502, cors, { error: 'blocked', model }); }
        if (a.error) { log({ event: 'voice', model, error: 'format', detail: a.error, ...a.info }); return json(502, cors, { error: 'format', detail: a.error, model }); }
        if (a.file) return { status: 200, headers: { ...cors, 'Content-Type': a.type, 'X-Content-Type-Options': 'nosniff' }, body: a.file };
        return { status: 200, headers: { ...cors, 'Content-Type': 'audio/wav', 'X-Content-Type-Options': 'nosniff' }, body: wav(a.pcm, a.rate) };
    }

    return { status, brain, voice };
}
