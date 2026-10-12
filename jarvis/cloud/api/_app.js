// One app per Vercel instance, so the switch, the model list and the rate limit are cached between requests.
// The leading underscore keeps Vercel from serving this file as a function of its own.
import { createApp } from '../lib/core.js';

const app = createApp({ env: process.env, log: e => console.log(JSON.stringify(e)) });

// Vercel's req and res, adapted to the plain {method, headers, body} -> {status, headers, body} shape core.js uses.
export function serve(which) {
    return async function handler(req, res) {
        const out = await app[which]({ method: req.method, headers: req.headers, body: req.body });
        for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
        // Since review 82, /api/voice streams: out.stream yields audio bytes as Google makes them, each written as it
        // comes. If the page goes away, the stream is closed, which stops reading from Google too.
        if (out.stream) {
            res.status(out.status);
            if (res.flushHeaders) res.flushHeaders();
            let gone = false;
            res.on('close', () => { gone = true; });
            try {
                for await (const chunk of out.stream) { if (gone) break; res.write(Buffer.from(chunk)); }
            } catch {
                res.destroy(); // Google broke off mid-line: a broken connection, so the page never keeps the part it got
                return;
            }
            res.end();
            return;
        }
        // /api/voice's fallback answers with audio bytes (a Uint8Array); everything else is text.
        res.status(out.status).send(typeof out.body === 'string' ? out.body : Buffer.from(out.body));
    };
}
