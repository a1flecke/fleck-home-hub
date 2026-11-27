import { expect, it } from 'vitest';
import { boughtClearBatch, groupGroceryItems, MAX_BOUGHT_CLEAR_ROWS } from '../src/lib/grocery/grouping';

const apples = { id: 'apples', name: 'Synthetic apples', completed: false };
const bread = { id: 'bread', name: 'Synthetic bread', completed: true };
const milk = { id: 'milk', name: 'Synthetic milk', completed: false };
const oats = { id: 'oats', name: 'Synthetic oats', completed: true };

it('separates incomplete and bought items while preserving their existing order', () => {
  expect(groupGroceryItems([apples, bread, milk, oats])).toEqual({
    toBuy: [apples, milk],
    bought: [bread, oats]
  });
});

it('keeps an item in the group being edited when its completion changes elsewhere', () => {
  const movedToBought = { ...bread, completed: true, version: 2 };
  const movedToBuy = { ...apples, completed: true, version: 2 };
  const groups = groupGroceryItems([movedToBuy, movedToBought], { apples: 'toBuy', bread: 'bought' });
  expect(groups.toBuy).toEqual([movedToBuy]);
  expect(groups.bought).toEqual([movedToBought]);
});

it('renders every item exactly once when a pin no longer matches its completion state', () => {
  const changed = { ...apples, completed: true };
  const groups = groupGroceryItems([changed, bread, milk], { apples: 'toBuy' });
  expect([...groups.toBuy, ...groups.bought].map(item => item.id).sort()).toEqual(['apples', 'bread', 'milk']);
  expect(groups.toBuy).toEqual([changed, milk]);
  expect(groups.bought).toEqual([bread]);
});

it('ignores a pin for a record that is not present', () => {
  expect(groupGroceryItems([apples, bread], { missing: 'bought' })).toEqual({ toBuy: [apples], bought: [bread] });
});

it('caps a bought-clear batch at MAX_BOUGHT_CLEAR_ROWS and reports remaining items', () => {
  const small = Array.from({ length: 3 }, (_, i) => ({ id: `b-${i}`, version: 2 }));
  expect(boughtClearBatch(small)).toEqual({ batch: small, remaining: 0 });

  const large = Array.from({ length: MAX_BOUGHT_CLEAR_ROWS + 7 }, (_, i) => ({ id: `b-${i}`, version: 2 }));
  const first = boughtClearBatch(large);
  expect(first.batch).toHaveLength(MAX_BOUGHT_CLEAR_ROWS);
  expect(first.batch[0].id).toBe('b-0');
  expect(first.batch.at(-1)?.id).toBe(`b-${MAX_BOUGHT_CLEAR_ROWS - 1}`);
  expect(first.remaining).toBe(7);
});
