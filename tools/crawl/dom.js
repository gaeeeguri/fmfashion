// src/lib/parser.js uses the browser's global DOMParser. Node has none, so borrow linkedom's.
// Not jsdom: it kept ~12 MB per parsed page and the overnight crawl ran out of heap (2026-11-04).
import { DOMParser } from 'linkedom';

if (typeof globalThis.DOMParser === 'undefined') {
  globalThis.DOMParser = DOMParser;
}
