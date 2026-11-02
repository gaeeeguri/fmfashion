import { test, expect } from 'vitest';
import bundled from '../../dictionary/brands.json';
import { compileMatchers, matchBrands } from '../../src/lib/matcher.js';

const m = compileMatchers(bundled);

test('aliases of steadyeverywhere', () => {
  for (const t of ['스에웨 데님 후기', 'SEW 코치자켓', 'sew 코치자켓', '스웨에에에에엑 샀다', '스테디 니트'])
    expect(matchBrands(t, ['steadyeverywhere'], m)).toEqual(['steadyeverywhere']);
});
test('sew inside english word does not match', () =>
  expect(matchBrands('sewing kit', ['steadyeverywhere'], m)).toEqual([]));
test('목동 maps to anotheroffice', () =>
  expect(matchBrands('오늘 목동 블레이저', ['anotheroffice'], m)).toEqual(['anotheroffice']));
test('paf does not match fafter', () => {
  expect(matchBrands('파프터 환불 안해줌', ['paf'], m)).toEqual([]);
  expect(matchBrands('파프 셔츠 핏', ['paf'], m)).toEqual(['paf']);
});
test('multiple brands', () =>
  expect(matchBrands('스에웨 + 목동 조합', ['steadyeverywhere', 'anotheroffice', 'paf'], m)).toEqual([
    'steadyeverywhere',
    'anotheroffice',
  ]));
test('unknown brand id ignored', () => expect(matchBrands('스에웨', ['nope'], m)).toEqual([]));
