/** Minimal in-memory stand-in for a chrome.storage area (promise API). */
export function memStorage(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) {
      const ks = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(ks.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    },
    async set(obj) {
      Object.assign(data, structuredClone(obj));
    },
  };
}
