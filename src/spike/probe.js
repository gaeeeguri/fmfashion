const B = 'https://www.fmkorea.com/';
const URLS = [
  ['검색', B + 'search.php?mid=fashion&search_target=title_content&search_keyword=' + encodeURIComponent('스에웨')],
  ['검색+category', B + 'search.php?mid=fashion&search_target=title_content&search_keyword=' + encodeURIComponent('스에웨') + '&category=18910473'],
  ['착샷 목록', B + 'index.php?mid=fashion&category=18910473'],
];
const out = document.getElementById('out');
const log = (s) => (out.textContent += s + '\n');
document.getElementById('go').onclick = async () => {
  out.textContent = '';
  for (const [name, url] of URLS) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      const html = await res.text();
      const blocked = html.includes('에펨코리아 보안 시스템');
      const rows = (html.match(/<td class="title/g) || []).length;
      const cats = [...html.matchAll(/<td class="cate"[^>]*>\s*<a[^>]*>([^<]+)/g)].map((m) => m[1]);
      log(`${name}: status=${res.status} blocked=${blocked} rows=${rows} cats=${[...new Set(cats)].join(',')}`);
    } catch (e) {
      log(`${name}: ERROR ${e}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  log('끝');
};
