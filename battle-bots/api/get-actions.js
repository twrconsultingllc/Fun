import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
    if (req.method === 'GET') {
        // GET Request: Fetch available models directly from Google's API endpoint
        try {
            const apiKey = process.env.GEMINI_API_KEY;
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            const data = await response.json();

            if (!response.ok) {
                return res.status(response.status).json({ error: data.error?.message || "Failed to fetch models" });
            }

            // Filter for models that support generating text/JSON content
            const availableModels = (data.models || [])
                .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
                .map(m => m.name.replace("models/", ""));

            return res.status(200).json({ models: availableModels });
        } catch (error) {
            console.error("Fetch Models Error:", error);
            return res.status(500).json({ error: error.message || "Failed to list models" });
        }
    } else if (req.method === 'POST') {
        // POST Request: Generate actions with the user's selected model
        const { gameState, selectedModel } = req.body;
        
        const modelName = selectedModel || "gemini-1.5-flash"; // Fallback default
        
        try {
            const model = genAI.getGenerativeModel({ 
                model: modelName,
                generationConfig: { responseMimeType: "application/json" }
            });

            const prompt = `
            You are the game engine controlling two battle bots, Bot A (Red) and Bot B (Blue). 
            Current Game State: ${JSON.stringify(gameState)}
            
            Rules: 
            - Bots want to close the distance to attack, or retreat if health is low.
            - Valid actions are: "ATTACK", "DEFEND", "MOVE_LEFT", or "MOVE_RIGHT".
            
            Respond with a strict JSON object mapping each bot to its action.
            Example: {"botA": "MOVE_RIGHT", "botB": "DEFEND"}
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