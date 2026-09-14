import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// MODULAR SKILL MATRIX (Easy to expand with new skills/abilities later)
const SKILL_CATALOG = {
    "SNIPE_STANCE": "Hold position, aim precisely, and fire a high-damage laser beam.",
    "FLANK_LEFT": "Circle-strafe left around the opponent while maintaining fire.",
    "FLANK_RIGHT": "Circle-strafe right around the opponent while maintaining fire.",
    "CHARGE_BEAM": "Rush forward directly at the target while firing heavy laser bursts.",
    "KITE_RETREAT": "Move backward away from the enemy while firing suppressive shots.",
    "DEFENSIVE_SHIELD": "Halt movement, raise energy shields to mitigate 75% incoming damage."
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
        const modelName = selectedModel || "gemini-1.5-flash";
        
        try {
            const model = genAI.getGenerativeModel({ 
                model: modelName,
                generationConfig: { responseMimeType: "application/json" }
            });

            const prompt = `
            You are the tactical combat engine for a 3D Battle Bot Arena.
            
            AVAILABLE SKILLS / RULES OF ENGAGEMENT:
            ${JSON.stringify(SKILL_CATALOG, null, 2)}

            STANDING PLAYER STRATEGIES:
            - Red Bot A Custom Directives: "${promptA || 'Be an aggressive fighter.'}"
            - Blue Bot B Custom Directives: "${promptB || 'Be a smart tactical defender.'}"

            CURRENT ARENA SNAPSHOT:
            ${JSON.stringify(gameState, null, 2)}

            INSTRUCTIONS:
            Evaluate the state against each bot's custom directives. Choose ONE skill from the CATALOG for each bot, and specify a target coordinate (x, z) between -15 and 15.

            Respond strictly in JSON format:
            {
              "botA": { "skill": "SKILL_NAME", "target": { "x": 0, "z": 0 }, "tacticalReasoning": "Short explanation" },
              "botB": { "skill": "SKILL_NAME", "target": { "x": 0, "z": 0 }, "tacticalReasoning": "Short explanation" }
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