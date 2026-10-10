# QR code encoder and decoder for `jarvis-test.html`

These two files let J.A.R.V.I.S. move settings between devices with a QR
code (Session 8 of `jarvis/build-plan.html`, in `jarvis-test.html` for now).
One device shows a code holding its settings and protocols; the other scans
it with the camera. It goes straight across, with no server and no file.

They're served from this site, not a CDN, so the page's CSP needs no new
host. The page loads each one only when a code is shown or scanned, with a
`<script>` tag carrying its SRI hash (`sha384-…` in `QR_LIBS`), so a changed
file is refused by the browser. Camera frames are read on the device, and the
CSP (`connect-src 'self'`) means nothing seen can be sent anywhere.

| File | What it is | Source | Licence |
| --- | --- | --- | --- |
| `qrcode.js` | QR code generator by Kazuhiko Arase | npm `qrcode-generator@1.4.4`, `qrcode.js` | MIT (in the file's header) |
| `jsQR.js` | QR code reader by Cosmo Wolfe | npm `jsqr@1.4.0`, `dist/jsQR.js` | Apache-2.0 (`LICENSE-jsQR`) |

Both are unmodified. The reader is used where the browser has no
`BarcodeDetector` that reads QR codes: Safari on iPhone, Firefox, and Chrome
on Windows and Linux. Chrome on Android uses its own `BarcodeDetector`.

SHA-256, checked by `tests/jarvis-test.dom.test.mjs`, which also checks that
the page's SRI hashes match these files:

```
18ae399f81182bc9de916e9c77b195df20cc58d6f2d55a62b085a299f1bf1780  qrcode.js
bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859  jsQR.js
```

To update, replace the files from a newer package version, then update these
hashes, the ones in the test, and the SRI hashes in the page together.
