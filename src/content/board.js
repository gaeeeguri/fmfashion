import { applyHiding, needsResync, classifyPage } from '../lib/boardPage.js';
import { compileMatchers } from '../lib/matcher.js';
import { loadSettings, saveSettings, normalizeSettings } from '../lib/settings.js';
import { parseFmfHash, encodeFmfHash } from '../lib/fmfHash.js';
import { createTokenBucket } from '../lib/tokenBucket.js';
import { createSearchSession } from '../lib/searchSession.js';
import { createResultView } from '../lib/resultView.js';
import { fetchPage } from '../lib/fetchPage.js';
import { snapshotKey, saveSnapshot, loadSnapshot } from '../lib/resultSnapshot.js';
import { mountPanel } from '../ui/panel.js';
import { mountBadge } from '../ui/badge.js';
import panelCss from '../ui/panel.css';

// The dictionary comes from the service worker: content scripts can't read the bundled
// copy without exposing it as a web-accessible resource.
const getDict = () => chrome.runtime.sendMessage({ type: 'getDictionary' });
const PANEL_OPEN_KEY = 'panelOpen';
const FASHION = 'https://www.fmkorea.com/fashion';

const page = classifyPage(location.href, document); // list | document | null (spec §11.3)
// One request budget for every fmkorea page view and tab (spec §5.4): kept in the site's
// localStorage so opening posts from the results doesn't hand out a fresh burst each time.
const BUCKET_KEY = 'fmf-request-bucket';
const take = createTokenBucket({
  store: {
    load: () => JSON.parse(localStorage.getItem(BUCKET_KEY) ?? 'null'),
    save: (v) => localStorage.setItem(BUCKET_KEY, JSON.stringify(v)),
  },
}).take;
let hidingApplied = false;
/** @type {null | { view: ReturnType<typeof createResultView>, session: ReturnType<typeof createSearchSession> | null }} */
let mode = null;
let syncSeq = 0;
let ui = null; // { badge, panel }
let saveNow = null; // writes the current run's snapshot (flushed on pagehide)
let saveTimer = 0;

function clearHash() {
  history.replaceState(null, '', location.pathname + location.search);
  syncMode();
}

function setSelection(brandIds, categoryKey) {
  if (!brandIds.length) return clearHash();
  location.hash = encodeFmfHash({ brandIds, categoryKey });
}

/** 보기 from the in-page panel: same tab, current page; rerun even when the hash is unchanged. */
function go(sel) {
  const h = encodeFmfHash(sel);
  if (!page.listRoot) location.href = FASHION + h;
  else if (location.hash === h) syncMode({ fresh: true }); // 보기 again = search again
  else location.hash = h;
}

async function applyPlainHiding(dict) {
  if (page.kind !== 'list') return; // post pages: the list under the article is left alone (spec §11.3)
  const { hiddenBrandIds } = await loadSettings(chrome.storage.sync, dict);
  if (!hiddenBrandIds.length && !hidingApplied) return;
  applyHiding(document, hiddenBrandIds, compileMatchers(dict));
  hidingApplied = hiddenBrandIds.length > 0;
}

async function syncMode({ fresh = false } = {}) {
  const my = ++syncSeq;
  saveNow?.(); // keep what the old run loaded before it goes away
  saveNow = null;
  clearTimeout(saveTimer);
  mode?.session?.cancel(); // stop the old run right away, before any await
  mode?.view.pause(); // and no sentinel-triggered load on it while we wait
  const sel = parseFmfHash(location.hash);
  const dict = await getDict();
  if (!dict || my !== syncSeq) return;

  if (!sel || !page.listRoot) {
    if (mode) {
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

  if (!mode) {
    mode = {
      view: createResultView(document, {
        onRemoveBrand: (id) => {
          const cur = parseFmfHash(location.hash);
          if (cur) setSelection(cur.brandIds.filter((x) => x !== id), cur.categoryKey);
        },
        onCancel: () => mode?.session?.cancel(),
        onExit: clearHash,
        onMore: () => mode?.session?.more(),
      }, { root: page.listRoot }),
      session: null,
    };
  }
  const view = mode.view;
  const linkHash = location.hash;
  // Posts opened from the results carry the same hash: show the list we already have (spec §11.3)
  const key = snapshotKey({ hash: linkHash, hiddenBrandIds, dictVersion: dict.version });
  const save = () => {
    const snap = session.snapshot();
    if (snap?.rows.length) saveSnapshot(localStorage, key, snap);
  };
  const session = createSearchSession({
    dict, matchers, fetchPage, take,
    onChange: (state) => {
      if (mode?.session !== session) return;
      view.render(state, {
        brands, categoryName: session.category?.name ?? '', totalTerms: state.totalTerms,
        linkHash, hiddenCount: hiddenBrandIds.length,
      });
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 400);
    },
  });
  mode.session = session;
  saveNow = save;
  const snap = fresh ? null : loadSnapshot(localStorage, key);
  if (!snap || !session.restore(snap)) {
    session.start({ brandIds: brands.map((b) => b.id), categoryKey: sel.categoryKey, hiddenBrandIds });
  }
}

async function mountUi() {
  const dict = await getDict();
  if (!dict) return;
  const settings = await loadSettings(chrome.storage.sync, dict);
  const got = await chrome.storage.local.get(PANEL_OPEN_KEY);
  const setOpen = (b) => {
    ui.badge.setOpen(b);
    chrome.storage.local.set({ [PANEL_OPEN_KEY]: b });
  };
  const badge = mountBadge(document, {
    open: got[PANEL_OPEN_KEY] === true,
    hiddenCount: settings.hiddenBrandIds.length,
    css: panelCss,
    onToggle: (b) => setOpen(b),
  });
  const panel = mountPanel(badge.panelRoot, {
    dict, settings,
    save: (s) => saveSettings(chrome.storage.sync, s),
    onGo: go,
    onClose: () => setOpen(false),
  });
  ui = { badge, panel, dict };
}

async function refreshUi(changes, area) {
  if (!ui) return;
  if (area === 'local' && changes[PANEL_OPEN_KEY]) ui.badge.setOpen(changes[PANEL_OPEN_KEY].newValue === true);
  if (area === 'local' && changes.dictionary) ui.dict = (await getDict()) ?? ui.dict;
  if ((area === 'sync' && changes.settings) || (area === 'local' && changes.dictionary)) {
    const s = area === 'sync' ? normalizeSettings(changes.settings.newValue, ui.dict) : await loadSettings(chrome.storage.sync, ui.dict);
    ui.panel.update(s, ui.dict);
    ui.badge.setHiddenCount(s.hiddenBrandIds.length);
  }
}

if (page) {
  mountUi();
  syncMode();
  window.addEventListener('hashchange', () => syncMode());
  window.addEventListener('pagehide', () => saveNow?.());
  chrome.storage.onChanged.addListener((changes, area) => {
    refreshUi(changes, area);
    if (needsResync(changes, area)) syncMode();
  });
}
