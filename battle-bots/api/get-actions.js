import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
    if (req.method === 'GET') {
        try {
            const apiKey = process.env.GEMINI_API_KEY;
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            const data = await response.json();

            if (!response.ok) {
                return res.status(response.status).json({ error: data.error?.message || "Failed to fetch models" });
            }

            const availableModels = (data.models || [])
                .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
                .map(m => m.name.replace("models/", ""));

            return res.status(200).json({ models: availableModels });
        } catch (error) {
            console.error("Fetch Models Error:", error);
            return res.status(500).json({ error: error.message || "Failed to list models" });
        }
    } else if (req.method === 'POST') {
        const { gameState, selectedModel } = req.body;
        const modelName = selectedModel || "gemini-1.5-flash";
        
        try {
            const model = genAI.getGenerativeModel({ 
                model: modelName,
                generationConfig: { responseMimeType: "application/json" }
            });

            // STRICT FORCED MOVEMENT PROMPT
            const prompt = `
            You are the game engine controlling two aggressive battle bots in a 1D arena:
            - Bot A (Red) is at position X = ${gameState.botA.positionX}
            - Bot B (Blue) is at position X = ${gameState.botB.positionX}
            - Current distance between them: ${gameState.distance} units.

            CRITICAL DIRECTIVES:
            1. If distance > 2, both bots MUST aggressively close the gap. Bot A MUST choose "MOVE_RIGHT" and Bot B MUST choose "MOVE_LEFT".
            2. If distance <= 2, bots MUST choose "ATTACK" or "DEFEND".

            Respond with a strict JSON object mapping each bot to its action.
            Example format: {"botA": "MOVE_RIGHT", "botB": "MOVE_LEFT"}
            `;

            const result = await model.generateContent(prompt);
            const botActions = JSON.parse(result.response.text());
            return res.status(200).json(botActions);
        } catch (error) {
            console.error("Gemini API Error:", error);
            return res.status(500).json({ error: error.message || "Unknown API Error" });
        }
    } else {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }
}