// One app per Vercel instance, so the switch, the model list and the rate limit are cached between requests.
// The leading underscore keeps Vercel from serving this file as a function of its own.
import { createApp } from '../lib/core.js';

const app = createApp({ env: process.env, log: e => console.log(JSON.stringify(e)) });

// Vercel's req and res, adapted to the plain {method, headers, body} -> {status, headers, body} shape core.js uses.
export function serve(which) {
    return async function handler(req, res) {
        const out = await app[which]({ method: req.method, headers: req.headers, body: req.body });
        for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
        // /api/voice answers with audio bytes (a Uint8Array); everything else is text.
        res.status(out.status).send(typeof out.body === 'string' ? out.body : Buffer.from(out.body));
    };
}
