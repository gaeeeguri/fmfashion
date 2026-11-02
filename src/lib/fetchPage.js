/**
 * The single gateway for every fmkorea request.
 * Provisional implementation: direct fetch from the extension context with the user's cookies.
 * If the Task 2 probe shows this is blocked, swap the body for a content-script fetch in an fmkorea tab.
 * @param {string} url
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ status: number, html: string }>}
 */
export async function fetchPage(url, signal) {
  const res = await fetch(url, { credentials: 'include', signal });
  return { status: res.status, html: await res.text() };
}
