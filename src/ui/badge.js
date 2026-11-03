// Floating filter badge on fmkorea fashion pages (spec §11.4). Everything lives in a shadow root so
// fmkorea's styles and ours never mix.
const HOST_ID = 'fmf-badge-host';

const BADGE_CSS = `
:host { all: initial; }
.fmf-wrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.fmf-panel { border-radius: 12px; overflow: hidden; box-shadow: 0 8px 28px rgba(0,0,0,.18); max-height: calc(100vh - 96px); overflow-y: auto; }
.fmf-panel[hidden] { display: none; }
.fmf-badge { border: 0; border-radius: 999px; padding: 9px 14px; background: #3b5bfd; color: #fff; font: 600 13px -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; box-shadow: 0 4px 14px rgba(59,91,253,.35); cursor: pointer; }
`;

/**
 * @param {Document} doc
 * @param {{ open: boolean, hiddenCount: number, css?: string, onToggle: (open: boolean) => void }} opts
 * @returns {{ host: HTMLElement, panelRoot: HTMLElement, setOpen: (b: boolean) => void,
 *   setHiddenCount: (n: number) => void, destroy: () => void }}
 */
export function mountBadge(doc, { open, hiddenCount, css = '', onToggle }) {
  doc.getElementById(HOST_ID)?.remove();
  const host = doc.createElement('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });

  const style = doc.createElement('style');
  style.textContent = css + BADGE_CSS;
  const wrap = doc.createElement('div');
  wrap.className = 'fmf-wrap';
  const panelRoot = doc.createElement('div');
  panelRoot.className = 'fmf-panel';
  const badge = doc.createElement('button');
  badge.type = 'button';
  badge.className = 'fmf-badge';
  wrap.append(panelRoot, badge);
  shadow.append(style, wrap);
  (doc.body ?? doc.documentElement).append(host);

  let isOpen = open;
  const setOpen = (b) => {
    isOpen = b;
    panelRoot.hidden = !b;
    badge.setAttribute('aria-expanded', String(b));
  };
  const setHiddenCount = (n) => {
    badge.textContent = n ? `필터 · ${n}` : '필터';
  };
  badge.onclick = () => onToggle(!isOpen);
  setOpen(open);
  setHiddenCount(hiddenCount);

  return { host, panelRoot, setOpen, setHiddenCount, destroy: () => host.remove() };
}
