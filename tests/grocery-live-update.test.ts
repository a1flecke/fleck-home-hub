import { expect, it } from 'vitest';
import {
  GROCERY_REFRESH_INTERVAL_MS,
  groceryAddDraftExists,
  groceryDraftIsDirty
} from '../src/lib/grocery/live-update';

it('treats any changed add-form field or duplicate confirmation as an active draft', () => {
  const empty = { name: '', quantity: '', unit: '', allowDuplicate: false };
  expect(groceryAddDraftExists(empty)).toBe(false);
  expect(groceryAddDraftExists({ ...empty, name: 'Synthetic pears' })).toBe(true);
  expect(groceryAddDraftExists({ ...empty, quantity: '2' })).toBe(true);
  expect(groceryAddDraftExists({ ...empty, unit: 'bags' })).toBe(true);
  expect(groceryAddDraftExists({ ...empty, allowDuplicate: true })).toBe(true);
  expect(groceryAddDraftExists({ ...empty, name: '   ' })).toBe(true);
});

it('detects changed edit fields and ignores fields restored to their saved values', () => {
  const saved = { name: 'Synthetic pears', quantity: '2', unit: 'bags' };
  expect(groceryDraftIsDirty(saved, saved)).toBe(false);
  expect(groceryDraftIsDirty({ ...saved, name: 'Synthetic plums' }, saved)).toBe(true);
  expect(groceryDraftIsDirty({ ...saved, quantity: '7' }, saved)).toBe(true);
  expect(groceryDraftIsDirty({ ...saved, unit: 'boxes' }, saved)).toBe(true);
  expect(groceryDraftIsDirty({ ...saved, quantity: '' }, saved)).toBe(true);
});

it('refreshes often enough to feel live without polling faster than every 20 seconds', () => {
  expect(GROCERY_REFRESH_INTERVAL_MS).toBeGreaterThanOrEqual(20_000);
  expect(GROCERY_REFRESH_INTERVAL_MS).toBeLessThanOrEqual(30_000);
});
