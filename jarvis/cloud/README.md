# J.A.R.V.I.S. supercharger proxy

A small Vercel project that holds the Gemini API key for `jarvis-test.html`
(Session 17 of [`jarvis/build-plan.html`](../build-plan.html#s17)). The page
lives on GitHub Pages and can't keep a secret, so it asks this proxy instead.

- `GET /api/status` → `{on, owner, model, until}`: is the supercharger on?
  Cached by Vercel's edge for 20 seconds.
- `POST /api/brain` → `{say, do, kind, model}`: one question to Gemini while
  it's on. `do` holds at most three action IDs, only ones the page listed.
  The page checks them again before running anything.

Nothing anyone asks is logged. Each answer logs only the model and its token
counts, so cost can be read from Vercel's logs.

## The switch

The owner turns it on and off in Vercel, never from the page. With an Edge
Config store connected to the project (`EDGE_CONFIG` is then set for you),
these items are read, and a change shows within about half a minute, with no
redeploy:

```json
{ "supercharge": false, "owner": "Your first name", "model": "gemini-3.5-flash" }
```

- `supercharge`: `true` (or `"on"`) to turn it on. Anything else is off.
- `until`: optional, an ISO time such as `"2026-10-11T23:00:00-04:00"`. After
  it, the supercharger is off even if `supercharge` is still `true`.
- `owner`: the name Jarvis says when it's turned on. Letters, spaces, `.'-`,
  at most 30 characters. It stays in Vercel, never in this repo.
- `model`: which Gemini model. If Google doesn't list it, the newest plain
  Flash model is used.

Without Edge Config, the same settings come from the environment variables
`SUPERCHARGE`, `SUPERCHARGE_UNTIL`, `OWNER_NAME` and `JARVIS_MODEL`, and a
change needs a redeploy. If Edge Config can't be read, it's off.

## Environment variables

| Name | What |
|---|---|
| `GEMINI_API_KEY` | The paid Gemini API key. Required. Without it, it's always off. |
| `EDGE_CONFIG` | Set by Vercel when an Edge Config store is connected. |
| `ALLOWED_ORIGINS` | Optional, comma-separated. Default `https://twrconsultingllc.github.io`. |

## Limits

Every field the page sends is bounded (the question at 500 characters, six
earlier turns, 1,500 characters of facts, 300 actions), answers are capped at
512 tokens, and each address gets 12 questions a minute. Those limits reset
when Vercel starts a new instance, so the real limits are on Google's side:
a budget alert and a daily request quota on the key's project.

## Tests

`tests/jarvis-cloud.test.mjs` imports `lib/core.js` and drives it with a fake
Gemini and a fake Edge Config:

```bash
cd tests
node run.mjs --only=jarvis-cloud
```

No dependencies: `lib/core.js` uses only `fetch`.
