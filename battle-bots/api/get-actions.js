import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SKILL_CATALOG = {
    "SNIPE_STANCE": { action: "Snipe", aggression: 10, speedModifier: 0.8 },
    "FLANK_LEFT": { action: "Flank Left", aggression: 60, speedModifier: 1.2 },
    "FLANK_RIGHT": { action: "Flank Right", aggression: 60, speedModifier: 1.2 },
    "CHARGE_BEAM": { action: "Aggressive Charge", aggression: 100, speedModifier: 1.5 },
    "KITE_RETREAT": { action: "Retreat", aggression: 0, speedModifier: 1.0 },
    "DEFENSIVE_SHIELD": { action: "Defend", aggression: 30, speedModifier: 0.5 }
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { gameState, promptA, promptB } = req.body;
    
    try {
        // Hardcoded to the fastest model with the highest limits
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
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
        return res.status(500).json({ error: error.message || "Unknown API Error" });
    }
}