# Hand tracking and face detection for `jarvis.html`

These files let the J.A.R.V.I.S. holo-projector follow your hands through the
camera, and let the threat scan (Session 5 of `jarvis/build-plan.html`, in
`jarvis-test.html` for now) find faces. They're served from this site, not a
CDN, so the page's CSP can say `connect-src 'self'`: the camera video is
processed in the browser, and nothing the page sees can be sent anywhere else.

They're loaded only when someone turns hand control on or opens the threat
scan (about 17 MB for hands, plus 0.2 MB for faces, cached by the browser
afterwards). The face detector only finds where faces are, as boxes. It can't
tell who anyone is, and the threat scan's readouts are made up at random.

| File | What it is | Source |
| --- | --- | --- |
| `vision_bundle.js` | MediaPipe Tasks Vision JavaScript API | npm `@mediapipe/tasks-vision@0.10.14`, `vision_bundle.mjs`, renamed to `.js` so any static host serves it as JavaScript |
| `vision_wasm_internal.js` | WebAssembly loader | same package, `wasm/vision_wasm_internal.js` |
| `vision_wasm_internal.wasm` | WebAssembly runtime (SIMD build) | same package, `wasm/vision_wasm_internal.wasm` |
| `hand_landmarker.task` | Hand landmark model (float16, v1) | `storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task` |
| `blaze_face_short_range.tflite` | Face detector model, short range (float16, v1) | `storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite` |

All five are unmodified, and licensed Apache-2.0 by Google. Only the SIMD
WebAssembly build is included. Every current browser supports WebAssembly
SIMD, and on one that doesn't, the page says hand tracking couldn't start.

SHA-256, checked by `tests/jarvis.dom.test.mjs` (the face model by `tests/jarvis-test.dom.test.mjs` until it's promoted):

```
e77f281f9619150d937023c355bae170e9120e3b9e43f1e23a2a7bee07197669  vision_bundle.js
9440cf0cc0cea21800e31581ec32aeedcc5fbf9df4509796bbc7d3f99e52ab9c  vision_wasm_internal.js
f82a8e6c05e08a44cc9f9e7ec5f845935bcbb1b1500ebe8c2f4812fb4e2917dc  vision_wasm_internal.wasm
fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1  hand_landmarker.task
b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f  blaze_face_short_range.tflite
```

To update, replace the files from a newer package version and model, then
update these hashes and the ones in the test together.
