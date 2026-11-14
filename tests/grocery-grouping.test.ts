import { expect, it } from 'vitest';
import { groupGroceryItems } from '../src/lib/grocery/grouping';

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
