/**
 * The single gateway for every fmkorea request.
 * Direct fetch from the extension context with the user's cookies — verified on 2026-11-02 to pass
 * fmkorea's security check (see spec §5 step 0). Callers wrap it with createPoliteFetch.
 * @param {string} url
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ status: number, html: string }>}
 */
export async function fetchPage(url, signal) {
  const res = await fetch(url, { credentials: 'include', signal });
  return { status: res.status, html: await res.text() };
}
