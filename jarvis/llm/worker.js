// J.A.R.V.I.S.'s full brain (Session 14): WebLLM's engine runs here, in a worker, off the page's main thread.
// That keeps the page moving while the model loads and thinks. It also matters for storage: WebLLM's logging
// library (loglevel) saves its log level in localStorage whenever an engine starts, and a worker has no
// localStorage, so nothing is written. The test copy never writes localStorage, which jarvis.html shares.
import { WebWorkerMLCEngineHandler } from './web-llm.js';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg) => handler.onmessage(msg);
