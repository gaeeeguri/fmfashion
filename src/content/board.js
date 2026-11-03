import { isFashionListUrl, applyHiding } from '../lib/boardPage.js';
import { compileMatchers } from '../lib/matcher.js';
import { loadSettings } from '../lib/settings.js';
import { parseFmfHash, encodeFmfHash } from '../lib/fmfHash.js';
import { createTokenBucket } from '../lib/tokenBucket.js';
import { createSearchSession } from '../lib/searchSession.js';
import { createResultView } from '../lib/resultView.js';
import { fetchPage } from '../lib/fetchPage.js';

// The dictionary comes from the service worker: content scripts can't read the bundled
// copy without exposing it as a web-accessible resource.
const getDict = () => chrome.runtime.sendMessage({ type: 'getDictionary' });

const take = createTokenBucket().take; // one bucket per page (spec §5.4)
let hidingApplied = false;
/** @type {null | { view: ReturnType<typeof createResultView>, session: ReturnType<typeof createSearchSession> }} */
let mode = null;
let syncSeq = 0;

function clearHash() {
  history.replaceState(null, '', location.pathname + location.search);
  syncMode();
}

function setSelection(brandIds, categoryKey) {
  if (!brandIds.length) return clearHash();
  location.hash = encodeFmfHash({ brandIds, categoryKey });
}

async function applyPlainHiding(dict) {
  const { hiddenBrandIds } = await loadSettings(chrome.storage.sync, dict);
  if (!hiddenBrandIds.length && !hidingApplied) return;
  applyHiding(document, hiddenBrandIds, compileMatchers(dict));
  hidingApplied = hiddenBrandIds.length > 0;
}

async function syncMode() {
  const my = ++syncSeq;
  const sel = parseFmfHash(location.hash);
  const dict = await getDict();
  if (!dict || my !== syncSeq) return;

  if (!sel) {
    if (mode) {
      mode.session.cancel();
      mode.view.destroy();
      mode = null;
    }
    return applyPlainHiding(dict);
  }

  const { hiddenBrandIds } = await loadSettings(chrome.storage.sync, dict);
  if (my !== syncSeq) return;
  const matchers = compileMatchers(dict);
  const brands = sel.brandIds
    .map((id) => dict.brands.find((b) => b.id === id))
    .filter((b) => b && !hiddenBrandIds.includes(b.id))
    .map((b) => ({ id: b.id, name: b.name }));

  mode?.session.cancel();
  if (!mode) {
    mode = {
      view: createResultView(document, {
        onRemoveBrand: (id) => {
          const cur = parseFmfHash(location.hash);
          if (cur) setSelection(cur.brandIds.filter((x) => x !== id), cur.categoryKey);
        },
        onCancel: () => mode?.session.cancel(),
        onExit: clearHash,
        onMore: () => mode?.session.more(),
      }),
      session: null,
    };
  }
  const view = mode.view;
  const session = createSearchSession({
    dict, matchers, fetchPage, take,
    onChange: (state) => {
      if (mode?.session !== session) return;
      view.render(state, { brands, categoryName: session.category?.name ?? '', totalTerms: state.totalTerms });
    },
  });
  mode.session = session;
  session.start({ brandIds: brands.map((b) => b.id), categoryKey: sel.categoryKey, hiddenBrandIds });
}

if (isFashionListUrl(location.href)) {
  syncMode();
  window.addEventListener('hashchange', syncMode);
  chrome.storage.onChanged.addListener((changes, area) => {
    if ((area === 'sync' && changes.settings) || (area === 'local' && changes.dictionary)) syncMode();
  });
}
