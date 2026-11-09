import { test, expect } from 'vitest';
import { parseTsv, toTsv } from '../../../tools/review/tsv.js';

test('parses a header row into objects, keeping empty cells', () => {
  expect(parseTsv('결정\tid\t메모\ny\tkinch\t\n')).toEqual({
    header: ['결정', 'id', '메모'],
    rows: [{ 결정: 'y', id: 'kinch', 메모: '' }],
  });
});

test('reads cells that Python csv quoted (quotes, tabs inside)', () => {
  const text = '결정\t예문\ny\t"그는 ""좋다"" 했다"\n?\t"탭\t포함"\n';
  expect(parseTsv(text).rows.map((r) => r.예문)).toEqual(['그는 "좋다" 했다', '탭\t포함']);
});

test('round-trips through toTsv', () => {
  const data = { header: ['결정', 'id', '예문'], rows: [{ 결정: 'y', id: 'a', 예문: '따옴표 " 와\t탭' }, { 결정: 'n', id: 'b', 예문: '' }] };
  expect(parseTsv(toTsv(data))).toEqual(data);
});
