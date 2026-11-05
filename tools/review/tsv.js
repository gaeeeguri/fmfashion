// Tab-separated tables written by Python's csv module (quotes when a cell holds a quote, tab or newline).

/** @param {string} text @returns {{ header: string[], rows: Record<string, string>[] }} */
export function parseTsv(text) {
  const records = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === '\t') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      records.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    records.push(row);
  }
  const [header = [], ...body] = records;
  return { header, rows: body.map((r) => Object.fromEntries(header.map((h, j) => [h, r[j] ?? '']))) };
}

const quote = (s) => (/["\t\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);

/** @param {{ header: string[], rows: Record<string, string>[] }} data */
export function toTsv({ header, rows }) {
  return [header, ...rows.map((r) => header.map((h) => String(r[h] ?? '')))].map((cells) => cells.map(quote).join('\t')).join('\n') + '\n';
}
