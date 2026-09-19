import { GoogleGenAI } from '@google/genai';

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

// Cached across warm invocations so validating a client-requested model on
// every tick doesn't double the calls made to Google's own API.
let modelCatalogCache = { models: [], fetchedAt: 0 };
const MODEL_CATALOG_TTL_MS = 5 * 60 * 1000;

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

async function listModels(apiKey) {
    const fresh = Date.now() - modelCatalogCache.fetchedAt < MODEL_CATALOG_TTL_MS;
    if (fresh && modelCatalogCache.models.length) return modelCatalogCache.models;
    const models = await fetchLiveModels(apiKey);
    modelCatalogCache = { models, fetchedAt: Date.now() };
    return models;
}

// No hardcoded fallback id: resolve against the live catalog instead. A
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
const MAX_PROMPT_LENGTH = 300;

// Bounds every field that flows into the prompt, so a hostile caller can't
// inflate token cost (or just crash the handler) with an oversized payload.
function validationError({ gameState, promptA, promptB }) {
    if (!gameState || typeof gameState !== 'object') {
        return 'gameState must be an object';
    }
    if (JSON.stringify(gameState).length > MAX_GAME_STATE_JSON_LENGTH) {
        return 'gameState payload too large';
    }
    for (const [name, value] of [['promptA', promptA], ['promptB', promptB]]) {
        if (value !== undefined && (typeof value !== 'string' || value.length > MAX_PROMPT_LENGTH)) {
            return `${name} must be a string under ${MAX_PROMPT_LENGTH} characters`;
        }
    }
    return null;
}

const SKILL_CATALOG = {
    "SNIPE_STANCE": { action: "Snipe", aggression: 10, speedModifier: 0.8 },
    "FLANK_LEFT": { action: "Flank Left", aggression: 60, speedModifier: 1.2 },
    "FLANK_RIGHT": { action: "Flank Right", aggression: 60, speedModifier: 1.2 },
    "CHARGE_BEAM": { action: "Aggressive Charge", aggression: 100, speedModifier: 1.5 },
    "KITE_RETREAT": { action: "Retreat", aggression: 0, speedModifier: 1.0 },
    "DEFENSIVE_SHIELD": { action: "Defend", aggression: 30, speedModifier: 0.5 }
};
const DEFAULT_SKILL = "SNIPE_STANCE";

// Never forward the model's raw output to the client: build a clean order
// from just the whitelisted skill name, so an arbitrary/malicious string in
// the model's response (or any extra field it invents) can't reach the
// browser's innerHTML sink in game.js.
function buildOrder(raw) {
    const skill = SKILL_CATALOG[raw?.skill] ? raw.skill : DEFAULT_SKILL;
    return { skill, stats: SKILL_CATALOG[skill] };
}

export default async function handler(req, res) {
    if (!isSameOriginRequest(req)) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (req.method === 'GET') {
        // Fetch the active model list from Google
        try {
            return res.status(200).json({ models: await listModels(apiKey) });
        } catch (error) {
            return res.status(error.status || 500).json({ error: safeMessage(error, "Failed to list models") });
        }
    } else if (req.method === 'POST') {
        const { gameState, selectedModel, promptA, promptB } = req.body || {};

        const badPayload = validationError({ gameState, promptA, promptB });
        if (badPayload) {
            return res.status(400).json({ error: badPayload });
        }

        try {
            const modelName = await resolveModel(selectedModel, apiKey);

            const prompt = `
            You are the tactical engine for a 2D Battle Arena.

            SKILLS AVAILABLE:
            ${JSON.stringify(SKILL_CATALOG, null, 2)}

            STANDING ORDERS:
            - Red Bot A: "${promptA || 'Circle strafe target.'}"
            - Blue Bot B: "${promptB || 'Snipe from distance.'}"

            CURRENT ARENA SNAPSHOT (Arena is 600x600):
            ${JSON.stringify(gameState, null, 2)}

            Select chosen skill.

            Respond strictly in JSON format:
            {
              "botA": { "skill": "SKILL_NAME" },
              "botB": { "skill": "SKILL_NAME" }
            }
            `;

            const response = await genAI.models.generateContent({
                model: modelName,
                contents: prompt,
                config: { responseMimeType: "application/json" }
            });
            const botActions = JSON.parse(response.text);

            const mappedActions = {
                botA: buildOrder(botActions.botA),
                botB: buildOrder(botActions.botB)
            };

            return res.status(200).json(mappedActions);
        } catch (error) {
            console.error("Gemini API Error:", error);
            const statusCode = error.status || ((error.message && error.message.includes('429')) ? 429 : 500);
            return res.status(statusCode).json({ error: safeMessage(error, "Unknown API Error") });
        }
    } else {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }
}