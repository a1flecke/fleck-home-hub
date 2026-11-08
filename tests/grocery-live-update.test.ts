import { expect, it } from 'vitest';
import {
  classifyGroceryRefreshResponse,
  GROCERY_REFRESH_INTERVAL_MS,
  GROCERY_REFRESH_TIMEOUT_MS,
  groceryAddDraftExists,
  groceryDraftIsDirty,
  parseGroceryItems
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

it('bounds each request well inside the refresh interval', () => {
  expect(GROCERY_REFRESH_TIMEOUT_MS).toBeGreaterThan(0);
  expect(GROCERY_REFRESH_TIMEOUT_MS).toBeLessThan(GROCERY_REFRESH_INTERVAL_MS);
});

it('classifies authorization failures separately from temporary outages', () => {
  expect(classifyGroceryRefreshResponse(200, 'application/json; charset=utf-8', false, '/groceries/data')).toBe('ok');
  expect(classifyGroceryRefreshResponse(503, 'application/json', false, '/groceries/data')).toBe('transient');
  expect(classifyGroceryRefreshResponse(500, null, false, '/groceries/data')).toBe('transient');
  expect(classifyGroceryRefreshResponse(401, 'application/json', false, '/groceries/data')).toBe('unauthenticated');
  expect(classifyGroceryRefreshResponse(403, 'application/json', false, '/groceries/data')).toBe('forbidden');
});

it('never treats a followed sign-in HTML response as successful grocery JSON', () => {
  expect(classifyGroceryRefreshResponse(200, 'text/html', true, 'http://localhost/sign-in')).toBe('unauthenticated');
  expect(classifyGroceryRefreshResponse(200, 'text/html', false, 'http://localhost/sign-in')).toBe('unauthenticated');
  expect(classifyGroceryRefreshResponse(200, 'text/html', false, 'http://localhost/groceries/data')).toBe('transient');
});

it('rejects malformed grocery payloads instead of replacing the displayed list', () => {
  const item = { id: 'item-1', name: 'Synthetic pears', quantity: '2', unit: 'bags', completed: false, version: 1 };
  expect(parseGroceryItems({ items: [item] })).toEqual([item]);
  expect(parseGroceryItems({ items: [] })).toEqual([]);
  expect(parseGroceryItems({ items: [{ ...item, completed: 'no' }] })).toBeNull();
  expect(parseGroceryItems({ items: [{ ...item, version: '1' }] })).toBeNull();
  expect(parseGroceryItems({ items: [{ ...item, name: undefined }] })).toBeNull();
  expect(parseGroceryItems({ items: 'not an array' })).toBeNull();
  expect(parseGroceryItems(null)).toBeNull();
  expect(parseGroceryItems([])).toBeNull();
});
