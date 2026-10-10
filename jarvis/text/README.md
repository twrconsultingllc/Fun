# The meaning module for `jarvis-test.html`

These files let J.A.R.V.I.S. understand rewordings: "show me the planet we live
on" for the globe, "got any good jokes" for a joke. It's Session 12 of
`jarvis/build-plan.html`, in `jarvis-test.html` for now.

They're served from this site, not a CDN, so the page's CSP keeps
`connect-src 'self'`. What you say is turned into a fingerprint (100 numbers)
in your browser, and nothing is sent anywhere.

They're loaded only when you say "upgrade your brain", never when the page
starts: about 12 MB, about the same as the hand tracker. Each visit starts
without them, and saying it again loads them from the browser's normal cache.
The page doesn't keep them in the Cache API or anywhere else, and the
fingerprints of the example sentences are worked out again each time. See the
session notes in `jarvis/build-plan.html` for why.

| File | What it is | Source |
| --- | --- | --- |
| `text_bundle.js` | MediaPipe Tasks Text JavaScript API | npm `@mediapipe/tasks-text@0.10.14`, `text_bundle.mjs`, renamed to `.js` so any static host serves it as JavaScript |
| `text_wasm_internal.js` | WebAssembly loader | same package, `wasm/text_wasm_internal.js` |
| `text_wasm_internal.wasm` | WebAssembly runtime (SIMD build) | same package, `wasm/text_wasm_internal.wasm` |
| `universal_sentence_encoder.tflite` | Universal Sentence Encoder text embedder (float32, v1) | `storage.googleapis.com/mediapipe-models/text_embedder/universal_sentence_encoder/float32/1/universal_sentence_encoder.tflite` |

All four are unmodified, and licensed Apache-2.0 by Google. The package is the
same version as the hand tracker's `@mediapipe/tasks-vision` in `jarvis/hands/`.
Only the SIMD WebAssembly build is included. Every current browser supports
WebAssembly SIMD, and on one that doesn't, Jarvis says he couldn't load the
module.

SHA-256, checked by `tests/jarvis-test.dom.test.mjs`:

```
e6d723a45c9d2f93cadaf86879ecb653324b855ddf0066ffdb5edc57124669ca  text_bundle.js
578cabc9cdccdf47eb3b1099379a975ecd32ab1c9336bd87494e23337adf79bb  text_wasm_internal.js
28cf973aa2575263a1eab07d52a22a0332a30117de1d1bffb147e29685ba5b7b  text_wasm_internal.wasm
89ad3c74175dd8caa398cc22b657296d94302d20c525c12b58b29420f7249749  universal_sentence_encoder.tflite
```

To update, replace the files from a newer package version and model, then
update these hashes and the ones in the test together. A new model moves every
similarity score, so the bands in the page (`MEAN_DO`, `MEAN_ASK`, `MEAN_GAP`)
need checking again against the real model, in `tests/jarvis-test.chromium.mjs`.
