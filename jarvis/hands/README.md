# Hand tracking for `jarvis.html`

These files let the J.A.R.V.I.S. holo-projector follow your hands through the
camera. They're served from this site, not a CDN, so the page's CSP can say
`connect-src 'self'`: the camera video is processed in the browser, and
nothing the page sees can be sent anywhere else.

They're loaded only when someone turns hand control on (about 17 MB, cached
by the browser afterwards).

| File | What it is | Source |
| --- | --- | --- |
| `vision_bundle.js` | MediaPipe Tasks Vision JavaScript API | npm `@mediapipe/tasks-vision@0.10.14`, `vision_bundle.mjs`, renamed to `.js` so any static host serves it as JavaScript |
| `vision_wasm_internal.js` | WebAssembly loader | same package, `wasm/vision_wasm_internal.js` |
| `vision_wasm_internal.wasm` | WebAssembly runtime (SIMD build) | same package, `wasm/vision_wasm_internal.wasm` |
| `hand_landmarker.task` | Hand landmark model (float16, v1) | `storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task` |

All four are unmodified, and licensed Apache-2.0 by Google. Only the SIMD
WebAssembly build is included. Every current browser supports WebAssembly
SIMD, and on one that doesn't, the page says hand tracking couldn't start.

SHA-256, checked by `tests/jarvis.dom.test.mjs`:

```
e77f281f9619150d937023c355bae170e9120e3b9e43f1e23a2a7bee07197669  vision_bundle.js
9440cf0cc0cea21800e31581ec32aeedcc5fbf9df4509796bbc7d3f99e52ab9c  vision_wasm_internal.js
f82a8e6c05e08a44cc9f9e7ec5f845935bcbb1b1500ebe8c2f4812fb4e2917dc  vision_wasm_internal.wasm
fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1  hand_landmarker.task
```

To update, replace the files from a newer package version and model, then
update these hashes and the ones in the test together.
