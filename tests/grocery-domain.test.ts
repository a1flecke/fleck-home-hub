import { describe, expect, it } from 'vitest';
import { boughtClearBatch, ingredientLines, MAX_BOUGHT_CLEAR_ROWS, probableGroceryMatch, sameGroceryName } from '../src/lib/grocery/domain';

describe('grocery item matching', () => {
  it('compares names without case or incidental whitespace', () => {
    expect(sameGroceryName('  Green  Apples ', 'green apples')).toBe(true);
    expect(sameGroceryName('1 onion', 'onion')).toBe(true);
    expect(sameGroceryName('onion', '2 onions')).toBe(false);
    expect(sameGroceryName('red apples', 'green apples')).toBe(false);
  });

  it('matches a parsed ingredient name against an existing structured item', () => {
    expect(probableGroceryMatch('onion', 'onion')).toBe(true);
    expect(probableGroceryMatch('onions', 'onion')).toBe(true);
    expect(probableGroceryMatch('diced tomatoes', 'diced tomato')).toBe(true);
    expect(probableGroceryMatch('black beans', 'black bean')).toBe(true);
  });

  it('matches plurals whose singular already ends in e or ie', () => {
    for (const [plural, singular] of [['cookies', 'cookie'], ['pies', 'pie'], ['cheeses', 'cheese'], ['brownies', 'brownie'], ['sauces', 'sauce'], ['limes', 'lime'], ['berries', 'berry'], ['peaches', 'peach'], ['glasses', 'glass'], ['potatoes', 'potato']]) {
      expect(probableGroceryMatch(plural, singular), `${plural} / ${singular}`).toBe(true);
      expect(probableGroceryMatch(singular, plural), `${singular} / ${plural}`).toBe(true);
    }
    expect(probableGroceryMatch('chocolate chip cookies', 'Chocolate chip cookie')).toBe(true);
    expect(probableGroceryMatch('cookies', '1 cookie')).toBe(true);
  });

  it('does not create matches from plural stripping alone', () => {
    expect(probableGroceryMatch('pies', 'pi')).toBe(false);
    expect(probableGroceryMatch('limes', 'lim')).toBe(false);
    expect(probableGroceryMatch('glass', 'gla')).toBe(false);
  });

  it('matches legacy items whose name still contains the whole ingredient line', () => {
    expect(probableGroceryMatch('onion', '1 onion')).toBe(true);
    expect(probableGroceryMatch('beans', '2 cups beans')).toBe(true);
    expect(probableGroceryMatch('diced tomatoes', '2 cans diced tomatoes')).toBe(true);
  });

  it('does not merge genuinely different products', () => {
    expect(probableGroceryMatch('green apples', 'red apples')).toBe(false);
    expect(probableGroceryMatch('oil', 'olive oil')).toBe(false);
    expect(probableGroceryMatch('tomatoes', 'diced tomatoes')).toBe(false);
    expect(probableGroceryMatch('beans', 'green beans')).toBe(false);
    expect(probableGroceryMatch('', 'onion')).toBe(false);
  });

  it('stays conservative for ambiguous legacy lines', () => {
    expect(probableGroceryMatch('diced tomatoes', '2 (15 oz) cans diced tomatoes')).toBe(false);
    expect(probableGroceryMatch('onion', '1 (15 oz) can onions')).toBe(false);
  });

  it('preserves ingredient quantities and ignores blank lines', () => {
    expect(ingredientLines(' 2 cups beans\n\n1 onion \r\n')).toEqual(['2 cups beans', '1 onion']);
  });
});

describe('bought clearing batches', () => {
  const items = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `item-${index}`, version: 2 }));

  it('offers every bought item when the list fits one clear request', () => {
    expect(boughtClearBatch(items(3), 200)).toEqual({ batch: items(3), remaining: 0 });
    expect(boughtClearBatch(items(200), 200)).toMatchObject({ remaining: 0 });
    expect(boughtClearBatch(items(200), 200).batch).toHaveLength(200);
  });

  it('caps one request at the server limit and reports the rows left for the next clear', () => {
    const result = boughtClearBatch(items(201), 200);
    expect(result.batch).toHaveLength(200);
    expect(result.remaining).toBe(1);
    expect(result.batch[0].id).toBe('item-0');
    expect(boughtClearBatch(items(450), 200)).toMatchObject({ remaining: 250 });
  });

  it('handles an empty list', () => {
    expect(boughtClearBatch([], 200)).toEqual({ batch: [], remaining: 0 });
  });

  it('uses the same limit the server enforces', () => {
    expect(MAX_BOUGHT_CLEAR_ROWS).toBe(200);
  });
});
