/**
 * The single gateway for every fmkorea request.
 * Same-origin fetch from the fmkorea content script with the user's cookies (spec §5.3).
 * Pacing comes from the per-page token bucket (tokenBucket.js), applied by the runner.
 * @param {string} url
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ status: number, html: string }>}
 */
export async function fetchPage(url, signal) {
  const res = await fetch(url, { credentials: 'include', signal });
  return { status: res.status, html: await res.text() };
}
