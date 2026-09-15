import { GoogleGenerativeAI } from '@google/generative-ai';
// Shared with the browser so the options offered and the behaviour implemented
// cannot drift apart.
import { SKILL_CATALOG, DEFAULT_SKILL, catalogForPrompt } from '../public/skills.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const PREFERRED_MODEL = "gemini-3.5-flash-lite";

async function listModels(apiKey) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await response.json();
    if (!response.ok) {
        const err = new Error(data.error?.message || "Failed to fetch models");
        err.status = response.status;
        throw err;
    }
    return (data.models || [])
        .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
        .map(m => m.name.replace("models/", ""));
}

// No hardcoded fallback id: an id that does not exist would 404 every call.
// Resolve against the live catalog instead, preferring a flash model.
async function resolveModel(requested, apiKey) {
    if (requested) return requested;
    const models = await listModels(apiKey);
    return models.find(m => m === PREFERRED_MODEL)
        || models.find(m => m.includes('flash-lite'))
        || models.find(m => m.includes('flash'))
        || models[0];
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
    const apiKey = process.env.GEMINI_API_KEY;

    if (req.method === 'GET') {
        try {
            return res.status(200).json({ models: await listModels(apiKey) });
        } catch (error) {
            return res.status(error.status || 500).json({ error: error.message || "Failed to list models" });
        }
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { teamId, model: requestedModel, prompt, gameState, memory } = req.body || {};

    if (!teamId || !gameState) {
        return res.status(400).json({ error: 'teamId and gameState are required' });
    }

    const botIds = (gameState.you?.bots || []).map(b => b.id);
    if (botIds.length === 0) {
        return res.status(200).json({ teamId, orders: {} });
    }

    try {
        const modelName = await resolveModel(requestedModel, apiKey);
        const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: { responseMimeType: "application/json" }
        });

        const result = await model.generateContent(buildPrompt({ teamId, prompt, gameState, memory, botIds }));
        const parsed = JSON.parse(result.response.text());
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
        const statusCode = (error.message && error.message.includes('429')) ? 429 : 500;
        return res.status(statusCode).json({ error: error.message || "Unknown API Error" });
    }
}
