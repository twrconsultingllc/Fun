# J.A.R.V.I.S.'s full brain (`jarvis-test.html`)

A small open language model that runs on your device's graphics chip, through
WebGPU. It's Session 14 of `jarvis/build-plan.html`, in `jarvis-test.html` for
now. Nothing here is loaded until you say "install your full brain" and then
answer yes. Every file comes from this site, never from Hugging Face or a CDN,
so the page's CSP keeps `connect-src 'self'` and gains no outside host.

The model is **Qwen3-0.6B**, in WebLLM's `Qwen3-0.6B-q4f16_1-MLC` build. It
answers only after the page's own patterns, the knowledge pack and the meaning
module have all passed on what you said. It answers in a fixed format, and can
only pick commands from the protocols' list of IDs, which the page checks before
running anything. See the session notes in `jarvis/build-plan.html`.

## The code: WebLLM and the model's engine

| File | What it is | Source |
| --- | --- | --- |
| `web-llm.js` | WebLLM, the in-browser engine (one ES module with its dependencies bundled: TVM's runtime, the tokenizer and `loglevel`) | npm `@mlc-ai/web-llm@0.2.85`, `lib/index.js`, renamed |
| `Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm` | The model's compiled WebAssembly engine | `github.com/mlc-ai/binary-mlc-llm-libs`, commit `025bcaf3780fa8254f5e5efd3bfea0a5397248f4`, `web-llm-models/v0_2_84/base/` |
| `LICENSE-web-llm` | WebLLM's licence (Apache-2.0) | the same npm package |
| `worker.js` | Ours: a few lines that run WebLLM's engine in a worker | written for this site |

`web-llm.js` and the engine are unmodified. The engine runs in a worker
(`worker.js`), off the page's main thread, so the page keeps moving while the
model loads and thinks. There's a second reason. WebLLM bundles a logging
library, `loglevel`, which saves its log level (the word `WARN`) in localStorage
whenever an engine starts on the page itself. The headless Chromium check found
this. The test copy never writes localStorage, which it shares with
`jarvis.html`. A worker has no localStorage, so nothing is written, and the page
never passes WebLLM a log level, which would make its main-thread side save one.

 WebLLM 0.2.85 sets its own `modelVersion` to
`v0_2_84/base`, and that folder has the exact engine its built-in model list
names for this model, `Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm`. The page passes the
engine as a full address on this site (in a worker, WebLLM resolves short paths
against the site's origin, which would drop `/Fun/`), and gives WebLLM SHA-256 integrity hashes for the
engine, `mlc-chat-config.json` and `tokenizer.json`. WebLLM checks those itself
and refuses to load if any differs.

`web-llm.js` ends with a `sourceMappingURL` comment for a map file that isn't
hosted. That only matters if you open the browser's developer tools, and it
leaves the file byte-for-byte as published.

`binary-mlc-llm-libs` has no licence file of its own. The engine is MLC LLM's
compiled output (MLC LLM and Apache TVM are Apache-2.0), published by the same
team for exactly this use with WebLLM. That's noted as open in review 66.

## The weights: `resolve/Qwen3-0.6B-q4f16_1-MLC/`

351.5 MB in 17 files plus the licence. The largest file is 77.8 MB, under
GitHub's 100 MB limit, and the whole site is about 390 MB, under GitHub Pages'
1 GB limit. The folder is named `resolve/…` because WebLLM only accepts a model
address with `resolve/<name>/` in it, as Hugging Face's addresses have.

They were brought in by the hand-run workflow **J.A.R.V.I.S. language model**
(`.github/workflows/jarvis-llm.yml`), running `fetch-model.mjs`. This container
gets 403 from Hugging Face. That run:

- downloads from the Hugging Face commit pinned in `models.json`, never `main`;
- refuses to continue unless the base model `Qwen/Qwen3-0.6B` says `apache-2.0`
  in its licence tag and on its model card, and its `LICENSE` is the Apache
  License 2.0. mlc-ai's build states no licence of its own. Its card names
  `Qwen/Qwen3-0.6B` as its base, so it inherits that licence. You decided that
  on 2026-10-10. A converted model whose card names any other base is refused,
  and any licence it does state must also be `apache-2.0`;
- checks every file's SHA-256 against `models.json`, and refuses a missing file,
  a file that isn't listed, or a name with a folder in it;
- keeps every file under 100 MB and the site under 1 GB;
- commits the files, and the base model's `LICENSE` beside them, as
  `github-actions[bot]`.

It starts with a dry run against the samples in `tests/fixtures/jarvis-llm/`,
which must refuse a changed chunk, a GPL model, a GPL base model, a file or site
over the limit, an unlisted file, an unpinned commit, a model card whose licence
disagrees with its tags, a converted model naming another base, and
`../escape.bin`.

Pinned on 2026-10-10: `mlc-ai/Qwen3-0.6B-q4f16_1-MLC` at
`8c14ce481d4c692769976ad52afea453a102df19`, base `Qwen/Qwen3-0.6B` at
`c1899de289a04d12100db370d81485cdf75e47ca`. Every file's hash is in
`models.json`.

The fallback, `Qwen2.5-0.5B-Instruct-q4f16_1-MLC` (289.7 MB), is pinned in
`models.json` too, but not fetched. Bringing it in would take a "fetch" run for
`qwen2.5-0.5b`, its own engine
(`Qwen2-0.5B-Instruct-q4f16_1_cs1k-webgpu.wasm`, from the same commit) and a
change to the page.

## Checking and re-running

To check the files in the repo against `models.json`:

```
node jarvis/llm/fetch-model.mjs --check=qwen3-0.6b
```

To run the dry run against the samples:

```
node jarvis/llm/fetch-model.mjs --dry-run
```

To bring in a model, run the workflow from the Actions tab: **pin** first (it
prints the hashes and commits nothing), copy its entry into `models.json`,
commit that, then **fetch**.

SHA-256 of the code files, checked by `tests/jarvis-test.dom.test.mjs`:

```
341bae95822bfee1d0fd6a0e6cd2db8613bb8edf809390ac142fba36ec17792c  web-llm.js
4db800b24119204e1a0386e8a12e084d5012aa60f77c5bffad362f20498df912  Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm
d412ab9d5ac17e6931705aac01e5a0d323da5acd2e89a2c19aa8fc05becc59ad  LICENSE-web-llm
63174cdf95486f8bb9ab18e49dcdfd48a5192a9a8b7d5f9d251d2592540d91e2  worker.js
```

## Where the files live in your browser

WebLLM keeps the downloaded files in the browser's Cache API (`webllm/config`,
`webllm/wasm`, `webllm/model`), the browser's own cache, not anything the page
saves. They stay until you
clear this site's data in the browser. The page has no command to delete them,
and it never stores anything the model says.
