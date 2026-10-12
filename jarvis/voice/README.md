# His own voice: the recordings

Session 18 of [`jarvis/build-plan.html`](../build-plan.html#s18). Jarvis says
each line in one of three voices, tried in this order:

1. **A recording on the site.** If `manifest.json` lists a recording of exactly
   those words for the current skin, it plays from here. No API call, and it
   works offline once the service worker has it.
2. **The live voice.** Otherwise, while the supercharger is on, the words go
   through the proxy's `/api/voice` (see [`../cloud/README.md`](../cloud/README.md))
   to Gemini's text-to-speech model. Fixed lines voiced this way are kept on
   the device, in a cache of the page's own. Answers from Gemini or the full
   brain are never kept, and nor is a line with a digit, a name or anything
   `personal()` flags.
3. **The browser's voice**, as before, for anything else and whenever
   something fails.

A setting picks *his voice* (the default: an answer that can't all be in his
voice is all in the browser's), *mixed* or *the browser's voice*.

## What's here

- `collect.mjs` opens `jarvis-test.html` in jsdom and asks it for
  `voiceLines(skin)`: every fixed line that skin says word for word, built from
  the same lists the page speaks from. A line with a digit, a date word or
  anything personal is never collected.
- `record.mjs` records what `collect.mjs` found. Only lines that are new or
  changed are sent; a line the page no longer says is removed with its file.
  `--dry-run` prints how many lines and how many MB it would add, with no key
  and no network.
- `manifest.json` lists every recording: its words, its file and the file's
  SHA-256 and size. The page reads only `lines`.
- `<skin>/<fingerprint>.mp3`: the recordings, 48 kbit/s mono MP3. The
  fingerprint is a hash of the skin, the voice, its style and the words, so a
  changed line or voice is a new file.

## Recording

Run **J.A.R.V.I.S. voice** from the Actions tab
([`.github/workflows/jarvis-voice.yml`](../../.github/workflows/jarvis-voice.yml)).
`dry-run`, the default, only prints what would be recorded. `record` runs the
same dry run, then records and commits as `github-actions[bot]`.

It needs the repository secret `GEMINI_API_KEY` (Settings → Secrets and
variables → Actions), the same key as the proxy's. Before relying on the
recordings, check [Google's Gemini API terms](https://ai.google.dev/gemini-api/terms)
on keeping generated audio and playing it back.

## Tests

```bash
cd tests
node run.mjs --only=jarvis-voice
```

`tests/jarvis-voice.test.mjs` checks every collected line against what the
page really says in typed turns, the manifest's hashes against the files, and
runs the recorder against a fake Gemini.
