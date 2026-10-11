/* J.A.R.V.I.S. supercharger: the logic behind the two Vercel functions in ../api/.
 *
 * The page on GitHub Pages asks /api/status whether the supercharger is on, and, while it is, sends what nothing on
 * the device understood to /api/brain, which asks Google's Gemini. The owner turns it on and off in Vercel, never on
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

/* ---------- The two handlers, without Vercel ---------- */
// Each takes {method, headers, body} and returns {status, headers, body}; ../api/*.js adapt Vercel's req and res.
export function createApp({ env, fetchImpl = fetch, now = Date.now, log = () => {} }) {
    const readSwitch = createSwitch({ env, fetchImpl, now });
    const liveModels = createCatalog({ env, fetchImpl, now });
    const allow = createLimiter({ now });
    const json = (status, headers, body) => ({ status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers }, body: JSON.stringify(body) });

    async function status(req) {
        const origin = req.headers.origin, cors = corsHeaders(origin, env);
        if (req.method === 'OPTIONS') return { status: 204, headers: cors, body: '' };
        if (req.method !== 'GET') return json(405, cors, { error: 'method' });
        const sw = await readSwitch(), t = now(), on = isOn(sw, t) && !!env.GEMINI_API_KEY;
        // Cached by Vercel's edge for 20 s, so a busy page doesn't read Edge Config for every visitor.
        return json(200, { ...cors, 'Cache-Control': 'public, max-age=0, s-maxage=20' }, {
            on, owner: sw.owner, model: on ? (sw.model || DEFAULT_MODEL) : null, until: on && sw.until ? new Date(sw.until).toISOString() : null
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

    return { status, brain };
}
