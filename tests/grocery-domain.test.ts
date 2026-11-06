import { describe, expect, it } from 'vitest';
import { ingredientLines, probableGroceryMatch, sameGroceryName } from '../src/lib/grocery/domain';

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
