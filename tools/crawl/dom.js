// src/lib/parser.js uses the browser's global DOMParser. Node has none, so borrow jsdom's.
import { JSDOM } from 'jsdom';

if (typeof globalThis.DOMParser === 'undefined') {
  globalThis.DOMParser = new JSDOM('').window.DOMParser;
}
