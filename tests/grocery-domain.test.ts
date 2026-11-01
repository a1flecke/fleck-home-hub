import { describe, expect, it } from 'vitest';
import { ingredientLines, sameGroceryName } from '../src/lib/grocery/domain';

describe('grocery item matching', () => {
  it('compares names without case or incidental whitespace', () => {
    expect(sameGroceryName('  Green  Apples ', 'green apples')).toBe(true);
    expect(sameGroceryName('1 onion', 'onion')).toBe(true);
    expect(sameGroceryName('onion', '2 onions')).toBe(false);
    expect(sameGroceryName('red apples', 'green apples')).toBe(false);
  });

  it('preserves ingredient quantities and ignores blank lines', () => {
    expect(ingredientLines(' 2 cups beans\n\n1 onion \r\n')).toEqual(['2 cups beans', '1 onion']);
  });
});
