import { isFashionListUrl, applyHiding } from '../lib/boardPage.js';
import { compileMatchers } from '../lib/matcher.js';
import { loadSettings } from '../lib/settings.js';

// The dictionary comes from the service worker: content scripts can't read the bundled
// copy without exposing it as a web-accessible resource.
const getDict = () => chrome.runtime.sendMessage({ type: 'getDictionary' });

let applied = false;

async function run() {
  const dict = await getDict();
  if (!dict) return;
  const { hiddenBrandIds } = await loadSettings(chrome.storage.sync, dict);
  if (!hiddenBrandIds.length && !applied) return;
  applyHiding(document, hiddenBrandIds, compileMatchers(dict));
  applied = hiddenBrandIds.length > 0;
}

if (isFashionListUrl(location.href)) {
  run();
  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === 'sync' && changes.settings) || (area === 'local' && changes.dictionary)) run();
  });
}
