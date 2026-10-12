# J.A.R.V.I.S. supercharger proxy

A small Vercel project that holds the Gemini API key for `jarvis-test.html`
(Session 17 of [`jarvis/build-plan.html`](../build-plan.html#s17)). The page
lives on GitHub Pages and can't keep a secret, so it asks this proxy instead.

- `GET /api/status` → `{on, owner, model, until, voice, version}`: is the
  supercharger on? `voice` says this deployment has `/api/voice`. `version` is
  the first seven characters of the commit Vercel built it from
  (`VERCEL_GIT_COMMIT_SHA`), so you can see a fix is live without opening
  Vercel. Cached by Vercel's edge for 20 seconds.
- `POST /api/brain` → `{say, do, kind, model}`: one question to Gemini while
  it's on. `do` holds at most three action IDs, only ones the page listed.
  The page checks them again before running anything.
- `POST /api/voice` → audio: one line he says, `{skin, text}` with at
  most 600 characters, spoken by Gemini's text-to-speech model while the
  supercharger is on (Session 18). Since review 82 the audio is **streamed**:
  the proxy asks Google's `streamGenerateContent` (`?alt=sse`) and passes the
  raw PCM on as it arrives, as `audio/L16;rate=24000;channels=1`, so he
  starts speaking about when Google starts instead of when it finishes. If
  anything goes wrong before the first audio (no streaming for that model,
  no audio in the stream, an audio file instead of PCM), the line is asked
  for the old way and comes back as one `audio/wav`. A quota error (429) or
  a blocked line is answered as it is, never asked twice. If Google breaks
  off after the audio has begun, the proxy breaks the connection rather
  than ending it cleanly, so the page plays what came but never keeps it.
  Each skin has its own named voice and style (`VOICES` in `lib/core.js`):
  Charon for Jarvis, Algenib for Morpheus, Fenrir for Stanley. Google is
  asked to speak only the line: the style goes in the request's system
  instruction, which isn't spoken (review 83). Before that it went in front
  of the words ("Say this …: words"), and every skin read it aloud. If a
  model refuses a system instruction (400), the line is asked again with the
  words alone, and that instance stops sending it. The model is looked up in Google's live model list: the
  newest Flash text-to-speech model, or `JARVIS_VOICE_MODEL` if Google lists
  it. If the list has none, it answers 502 and the page uses the browser's
  voice. The recordings on the site (`jarvis/voice/`) are made with the same
  request, so they sound the same.

Nothing anyone asks, and nothing he says, is logged. Each answer and each
voiced line logs only the model and its token counts, so cost can be read
from Vercel's logs. A voiced line also logs `chars` (how many characters were
voiced), `ms` (how long Google took for the whole line), and, when streamed,
`stream: true` and `first` (milliseconds from asking Google until the first
audio), and `style` (false once a model has refused the system
instruction). At Google's
25 audio tokens a second, `out / 25` is the seconds of speech, so `chars`
against that shows the pace. A line that couldn't stream logs
`stream: false` and `why`.

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
change needs a redeploy. Since 2026-10-11 it's **on by default** there: with
`SUPERCHARGE` unset or empty it's on, and `SUPERCHARGE=false` (or `off`, `0`,
anything but `true`/`on`) turns it off. The owner chose this so the
supercharger works without any Vercel settings, with cost controlled by the
budget and daily quota on Google's side. Without `OWNER_NAME`, Jarvis says
"My owner has turned on my supercharger". If Edge Config is connected but
can't be read, it's off. With no `GEMINI_API_KEY`, it's always off.

## Setting up the Vercel project

The project's **Root Directory** must be `jarvis/cloud` (Settings → Build and
Deployment), with the Framework Preset **Other**. From the repo's top folder
Vercel finds no `api/`, and every address answers `404 NOT_FOUND`. The proxy
has no home page either, so its bare address always answers 404. Check it at
`/api/status`. The test copy uses `https://jarvis-cloud-gamma.vercel.app`.

A change to the environment variables only reaches the function on a new
deployment (Deployments → the latest one → Redeploy). `vercel.json` skips a
Git-triggered build when nothing under `jarvis/cloud/` changed since the
commit Vercel last deployed (`VERCEL_GIT_PREVIOUS_SHA`), so other work in the
repo doesn't redeploy it. A commit that does change this folder deploys it.
The battle-bots projects use the same rule; `tests/vercel-builds.test.mjs`
runs it.

If Vercel answers a deploy with "Deployment rate limited", the account has
used its daily deployments. Nothing deploys until it frees up, and the live
proxy keeps running its last deployed code. Check what it runs with
`/api/status`.

## Environment variables

| Name | What |
|---|---|
| `GEMINI_API_KEY` | The paid Gemini API key. Required. Without it, it's always off. |
| `EDGE_CONFIG` | Set by Vercel when an Edge Config store is connected. |
| `ALLOWED_ORIGINS` | Optional, comma-separated. Default `https://twrconsultingllc.github.io`. |
| `JARVIS_VOICE_MODEL` | Optional. A text-to-speech model to use for `/api/voice`, if Google lists it. |

## Limits

Every field the page sends is bounded (the question at 500 characters, six
earlier turns, 1,500 characters of facts, 300 actions), answers are capped at
512 tokens, and each address gets 12 questions a minute. `/api/voice` takes at most 600
characters and has its own limit of 40 lines a minute per address (the page
sends each answer as one piece of up to 600 characters since review 85), and its function may run for 30 seconds
(`vercel.json`). A streamed line passes on at most about 80 seconds of audio,
the same cap as before.

If Google's audio answer can't be read, `/api/voice` answers 502 and logs
`{"event":"voice","error":"format","detail":…,"mime":…,"parts":…,"bytes":…}`:
which check failed and what Google called its audio, never the words. The
reader accepts audio in any part, either base64 alphabet, any 16-bit PCM label
(24 kHz unless it names a rate), and passes a WAV, MP3 or other audio file
through unchanged. On 2026-10-12 the first, stricter reader refused the real
model's answer this way, with nothing in the log to say why. Those limits reset
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
