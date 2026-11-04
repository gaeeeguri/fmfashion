// The only place that talks to fmkorea: a visible Chromium window on a dedicated profile.
// Requests are same-origin fetches from inside the fmkorea tab, exactly like the probes (spec §4.1).
import { chromium } from 'playwright';
import net from 'node:net';

const ORIGIN = 'https://www.fmkorea.com';
const FASHION = `${ORIGIN}/fashion`;
const TIMEOUT_MS = 20000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** TCP reachability of fmkorea:443 — no HTTP request, so it costs nothing against the rate limit. */
function canConnect(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: 'www.fmkorea.com', port: 443 });
    const done = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

/**
 * @param {{ profileDir: string, log: (msg: string) => void }} o
 */
export async function openBrowser({ profileDir, log }) {
  const ctx = await chromium.launchPersistentContext(profileDir, { headless: false, viewport: null });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  async function ensureOnFmkorea() {
    if (page.url().startsWith(ORIGIN)) return;
    await page.goto(FASHION, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
  try {
    await ensureOnFmkorea();
  } catch (e) {
    log(`could not open ${FASHION}: ${e.message}`);
  }

  /** @returns {Promise<{status: number, html: string} | {error: 'network'|'timeout'}>} */
  async function fetchPage(url) {
    try {
      await ensureOnFmkorea();
      return await page.evaluate(
        async ({ url, timeoutMs }) => {
          const ctl = new AbortController();
          const t = setTimeout(() => ctl.abort(), timeoutMs);
          try {
            const res = await fetch(url, { credentials: 'include', cache: 'no-store', signal: ctl.signal });
            return { status: res.status, html: await res.text() };
          } catch (e) {
            return { error: e.name === 'AbortError' ? 'timeout' : 'network' };
          } finally {
            clearTimeout(t);
          }
        },
        { url, timeoutMs: TIMEOUT_MS },
      );
    } catch (e) {
      // page crashed, navigated away, or could not load while offline
      log(`page error (${e.message.split('\n')[0]}) — will reload`);
      await page.goto('about:blank').catch(() => {});
      return { error: 'network' };
    }
  }

  async function waitForNetwork() {
    let wait = 2000;
    for (;;) {
      if (await canConnect()) return;
      log(`offline — retry in ${wait / 1000}s`);
      await sleep(wait);
      wait = Math.min(wait * 2, 60000);
    }
  }

  return { fetchPage, waitForNetwork, close: () => ctx.close() };
}
