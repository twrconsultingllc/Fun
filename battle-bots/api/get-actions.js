import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SKILL_CATALOG = {
    "SNIPE_STANCE": "Hold distance, lock aim, and fire high-velocity long-range laser bolts.",
    "FLANK_LEFT": "Circle-strafe left around the target while maintaining continuous laser fire.",
    "FLANK_RIGHT": "Circle-strafe right around the target while maintaining continuous laser fire.",
    "CHARGE_BEAM": "Aggressively close range directly toward target while firing rapid bursts.",
    "KITE_RETREAT": "Back away from enemy while maintaining suppressive laser fire.",
    "DEFENSIVE_SHIELD": "Deploy energy shield to reduce incoming damage by 75% while tactical maneuvering."
};

export default async function handler(req, res) {
    if (req.method === 'GET') {
        try {
            const apiKey = process.env.GEMINI_API_KEY;
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            const data = await response.json();

            if (!response.ok) return res.status(response.status).json({ error: data.error?.message || "Failed to fetch models" });

            const availableModels = (data.models || [])
                .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
                .map(m => m.name.replace("models/", ""));

            return res.status(200).json({ models: availableModels, skills: Object.keys(SKILL_CATALOG) });
        } catch (error) {
            return res.status(500).json({ error: error.message || "Failed to list models" });
        }
    } else if (req.method === 'POST') {
        const { gameState, selectedModel, promptA, promptB } = req.body;
        const modelName = selectedModel || "gemini-1.5-flash"; // Safest default
        
        try {
            const model = genAI.getGenerativeModel({ 
                model: modelName,
                generationConfig: { responseMimeType: "application/json" }
            });

            const prompt = `
            You are the tactical engine for a 3D Battle Arena.
            
            SKILLS AVAILABLE:
            ${JSON.stringify(SKILL_CATALOG, null, 2)}

            STANDING ORDERS:
            - Red Bot A: "${promptA || 'Circle strafe target.'}"
            - Blue Bot B: "${promptB || 'Snipe from distance.'}"

            CURRENT ARENA SNAPSHOT:
            ${JSON.stringify(gameState, null, 2)}

            Select target coordinates inside arena bounds (x between -16 and 16, z between -16 and 16) and chosen skill.

            Respond strictly in JSON format:
            {
              "botA": { "skill": "SKILL_NAME", "target": { "x": 0, "z": 0 } },
              "botB": { "skill": "SKILL_NAME", "target": { "x": 0, "z": 0 } }
            }
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