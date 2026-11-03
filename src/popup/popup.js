import { getDictionary, isRefreshDue } from '../lib/dictionaryStore.js';
import { loadSettings, saveSettings } from '../lib/settings.js';
import { encodeFmfHash, goTarget } from '../lib/fmfHash.js';
import { mountPanel } from '../ui/panel.js';

async function main() {
  const dict = await getDictionary(chrome.storage.local);
  const settings = await loadSettings(chrome.storage.sync, dict);
  mountPanel(document.getElementById('app'), {
    dict,
    settings,
    save: (s) => saveSettings(chrome.storage.sync, s),
    onGo: async (sel) => {
      // Results show inside the fmkorea fashion board itself (spec §4.2).
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const { action, url } = goTarget(tab?.url, encodeFmfHash(sel));
      if (action === 'update' && tab?.id != null) await chrome.tabs.update(tab.id, { url });
      else await chrome.tabs.create({ url });
      window.close();
    },
  });
  if (await isRefreshDue(chrome.storage.local, Date.now())) chrome.runtime.sendMessage({ type: 'refreshDictionary' });
}

main();
