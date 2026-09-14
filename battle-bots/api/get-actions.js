import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini with the API key stored securely in Vercel
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { gameState } = req.body;
    
    // Instantiate the active model
    const model = genAI.getGenerativeModel({ 
        model: "gemini-3.5-flash",
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

    try {
        const result = await model.generateContent(prompt);
        const botActions = JSON.parse(result.response.text());
        res.status(200).json(botActions);
    } catch (error) {
        console.error("Gemini API Error:", error);
        res.status(500).json({ error: "Failed to generate bot actions" });
    }
}