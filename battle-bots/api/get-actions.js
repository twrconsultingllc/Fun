import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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


const SKILL_CATALOG = {
    "SNIPE_STANCE": { action: "Snipe", aggression: 10, speedModifier: 0.8 },
    "FLANK_LEFT": { action: "Flank Left", aggression: 60, speedModifier: 1.2 },
    "FLANK_RIGHT": { action: "Flank Right", aggression: 60, speedModifier: 1.2 },
    "CHARGE_BEAM": { action: "Aggressive Charge", aggression: 100, speedModifier: 1.5 },
    "KITE_RETREAT": { action: "Retreat", aggression: 0, speedModifier: 1.0 },
    "DEFENSIVE_SHIELD": { action: "Defend", aggression: 30, speedModifier: 0.5 }
};

export default async function handler(req, res) {
    if (req.method === 'GET') {
        // Fetch the active model list from Google
        try {
            const apiKey = process.env.GEMINI_API_KEY;
            const response = await fetch(GEMINI_MODELS_URL, { headers: geminiHeaders(apiKey) });
            const data = await response.json();

            if (!response.ok) return res.status(response.status).json({ error: safeMessage({ message: data.error?.message }, "Failed to fetch models") });

            const availableModels = (data.models || [])
                .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
                .map(m => m.name.replace("models/", ""));

            return res.status(200).json({ models: availableModels });
        } catch (error) {
            return res.status(500).json({ error: safeMessage(error, "Failed to list models") });
        }
    } else if (req.method === 'POST') {
        const { gameState, selectedModel, promptA, promptB } = req.body;
        
        // Use the user's selected model, falling back to 3.5-flash
        const modelName = selectedModel || "gemini-3.5-flash";
        
        try {
            const model = genAI.getGenerativeModel({ 
                model: modelName,
                generationConfig: { responseMimeType: "application/json" }
            });

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

            const result = await model.generateContent(prompt);
            const botActions = JSON.parse(result.response.text());
            
            const mappedActions = {
                botA: { ...botActions.botA, stats: SKILL_CATALOG[botActions.botA?.skill] || SKILL_CATALOG["SNIPE_STANCE"] },
                botB: { ...botActions.botB, stats: SKILL_CATALOG[botActions.botB?.skill] || SKILL_CATALOG["SNIPE_STANCE"] }
            };

            return res.status(200).json(mappedActions);
        } catch (error) {
            console.error("Gemini API Error:", error);
            const statusCode = (error.message && error.message.includes('429')) ? 429 : 500;
            return res.status(statusCode).json({ error: safeMessage(error, "Unknown API Error") });
        }
    } else {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }
}