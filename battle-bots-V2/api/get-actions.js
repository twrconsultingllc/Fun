import { GoogleGenAI } from '@google/genai';
// Shared with the browser so the options offered and the behaviour implemented
// cannot drift apart.
import { SKILL_CATALOG, DEFAULT_SKILL, catalogForPrompt } from '../public/skills.js';

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// The key must never reach the browser. Two defences:
//   1. Send it as a header so it is not embedded in a URL that a network-layer
//      error, a log line or a proxy could quote back.
//   2. Redact anything key-shaped from error text before returning it, since
//      these messages are surfaced in the UI.
const GEMINI_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

function geminiHeaders(apiKey) {
    return { "x-goog-api-key": apiKey || "" };
}

function safeMessage(error, fallback) {
    const raw = (error && error.message) || "";
    if (!raw) return fallback;
    const scrubbed = raw
        .replace(/([?&]key=)[^&\s"'`]+/gi, "$1[redacted]")
        .replace(/AIza[0-9A-Za-z_-]{10,}/g, "[redacted]")
        .replace(/(x-goog-api-key["':\s]+)[^\s"',}]+/gi, "$1[redacted]")
        .slice(0, 300);
    return scrubbed.trim() || fallback;
}

// A request coming from the page's own JS always carries a same-host Origin
// or Referer (browsers attach Origin to every POST, same-origin or not).
// A bare curl call can omit both and slip through — this only raises the
// bar against casual/browser-based abuse, it is not an auth boundary.
function isSameOriginRequest(req) {
    const host = req.headers.host;
    if (!host) return true;
    const candidate = req.headers.origin || req.headers.referer;
    if (!candidate) return true;
    try {
        return new URL(candidate).host === host;
    } catch {
        return false;
    }
}

const PREFERRED_MODEL = "gemini-3.5-flash-lite";

async function fetchLiveModels(apiKey) {
    const response = await fetch(GEMINI_MODELS_URL, { headers: geminiHeaders(apiKey) });
    const data = await response.json();
    if (!response.ok) {
        const err = new Error(safeMessage({ message: data.error?.message }, "Failed to fetch models"));
        err.status = response.status;
        throw err;
    }
    return (data.models || [])
        .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
        .map(m => m.name.replace("models/", ""));
}

// Cached across warm invocations so validating a client-requested model on
// every tick doesn't double the calls made to Google's own API — the catalog
// changes rarely enough that a few minutes of staleness is fine.
let modelCatalogCache = { models: [], fetchedAt: 0 };
const MODEL_CATALOG_TTL_MS = 5 * 60 * 1000;

async function listModels(apiKey) {
    const fresh = Date.now() - modelCatalogCache.fetchedAt < MODEL_CATALOG_TTL_MS;
    if (fresh && modelCatalogCache.models.length) return modelCatalogCache.models;
    const models = await fetchLiveModels(apiKey);
    modelCatalogCache = { models, fetchedAt: Date.now() };
    return models;
}

// No hardcoded fallback id: an id that does not exist would 404 every call.
// Resolve against the live catalog instead, preferring a flash model. A
// client-requested model is only honoured if it is actually in that catalog
// — otherwise a caller could force an arbitrary (and possibly costly) model.
async function resolveModel(requested, apiKey) {
    const models = await listModels(apiKey);
    if (requested && models.includes(requested)) return requested;
    return models.find(m => m === PREFERRED_MODEL)
        || models.find(m => m.includes('flash-lite'))
        || models.find(m => m.includes('flash'))
        || models[0];
}

const MAX_GAME_STATE_JSON_LENGTH = 20000;
const MAX_PROMPT_LENGTH = 400;
const MAX_MEMORY_ENTRIES = 30;
const MAX_MEMORY_ENTRY_LENGTH = 200;

// Bounds every field that flows into the prompt, so a hostile caller can't
// inflate token cost (or just crash the handler) with an oversized payload.
function validationError({ teamId, gameState, prompt, memory }) {
    if (typeof teamId !== 'string' || teamId.length === 0 || teamId.length > 40) {
        return 'teamId must be a short string';
    }
    if (!gameState || typeof gameState !== 'object') {
        return 'gameState must be an object';
    }
    if (JSON.stringify(gameState).length > MAX_GAME_STATE_JSON_LENGTH) {
        return 'gameState payload too large';
    }
    if (prompt !== undefined && (typeof prompt !== 'string' || prompt.length > MAX_PROMPT_LENGTH)) {
        return `prompt must be a string under ${MAX_PROMPT_LENGTH} characters`;
    }
    if (memory !== undefined) {
        if (typeof memory !== 'object' || memory === null) return 'memory must be an object';
        for (const key of ['events', 'history']) {
            const list = memory[key];
            if (list === undefined) continue;
            const ok = Array.isArray(list)
                && list.length <= MAX_MEMORY_ENTRIES
                && list.every(e => typeof e === 'string' && e.length <= MAX_MEMORY_ENTRY_LENGTH);
            if (!ok) return `memory.${key} is malformed or too large`;
        }
    }
    return null;
}

function buildPrompt({ teamId, prompt, gameState, memory, botIds }) {
    const events = memory?.events?.length ? memory.events.join('\n- ') : 'none yet';
    const history = memory?.history?.length ? memory.history.join('\n- ') : 'no previous matches';

    return `
You are the tactical engine commanding the ${teamId.toUpperCase()} team in a 2D battle arena.
You control ONLY your own bots. Every other bot is hostile.

STANDING ORDERS FROM YOUR COMMANDER:
"${prompt || 'Fight to win.'}"

SKILLS AVAILABLE (pick exactly one per bot):
${JSON.stringify(catalogForPrompt(), null, 2)}

ARENA SNAPSHOT (600x600). Cover blocks movement, line of sight and every shot,
but it is destructible and its hp is shown. Pickups grant health, shields, or a
temporary damage or speed boost to the first bot that reaches them:
${JSON.stringify(gameState, null, 2)}

WHAT HAPPENED RECENTLY THIS MATCH:
- ${events}

PREVIOUS MATCHES:
- ${history}

Choose a skill for each of your bots: ${botIds.join(', ')}.
Take the standing orders, each bot's HP, its distance and line of sight to enemies,
and the damage it just took into account. Adapt if what you have been doing is not working.

Respond strictly as JSON, with one entry per bot id, and nothing else:
{
  "orders": {
${botIds.map(id => `    "${id}": { "skill": "SKILL_NAME", "reasoning": "under 12 words", "taunt": "under 8 words" }`).join(',\n')}
  }
}
`;
}

export default async function handler(req, res) {
    if (!isSameOriginRequest(req)) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (req.method === 'GET') {
        try {
            return res.status(200).json({ models: await listModels(apiKey) });
        } catch (error) {
            return res.status(error.status || 500).json({ error: safeMessage(error, "Failed to list models") });
        }
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { teamId, model: requestedModel, prompt, gameState, memory } = req.body || {};

    const badPayload = validationError({ teamId, gameState, prompt, memory });
    if (badPayload) {
        return res.status(400).json({ error: badPayload });
    }

    const botIds = (gameState.you?.bots || []).map(b => b.id);
    if (botIds.length === 0) {
        return res.status(200).json({ teamId, orders: {} });
    }

    try {
        const modelName = await resolveModel(requestedModel, apiKey);
        const response = await genAI.models.generateContent({
            model: modelName,
            contents: buildPrompt({ teamId, prompt, gameState, memory, botIds }),
            config: { responseMimeType: "application/json" }
        });

        const parsed = JSON.parse(response.text);
        const rawOrders = parsed.orders || parsed;

        // Attach engine stats server-side and guarantee an order for every bot,
        // so a malformed or partial model response can never stall a team.
        const orders = {};
        for (const id of botIds) {
            const order = rawOrders[id] || {};
            const skill = SKILL_CATALOG[order.skill] ? order.skill : DEFAULT_SKILL;
            orders[id] = {
                skill,
                reasoning: typeof order.reasoning === 'string' ? order.reasoning.slice(0, 120) : '',
                taunt: typeof order.taunt === 'string' ? order.taunt.slice(0, 80) : '',
                fallback: !SKILL_CATALOG[order.skill],
                stats: SKILL_CATALOG[skill]
            };
        }

        return res.status(200).json({ teamId, model: modelName, orders });
    } catch (error) {
        console.error(`Gemini API Error (${teamId}):`, error);
        const statusCode = error.status || ((error.message && error.message.includes('429')) ? 429 : 500);
        return res.status(statusCode).json({ error: safeMessage(error, "Unknown API Error") });
    }
}
