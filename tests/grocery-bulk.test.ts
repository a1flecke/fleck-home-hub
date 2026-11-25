import { describe, expect, it } from 'vitest';
import {
  buildBulkReview,
  bulkItemKey,
  MAX_BULK_INPUT_CHARS,
  MAX_BULK_LINES,
  readBulkInput
} from '../src/lib/grocery/bulk';

const noActive: Array<{ id: string; name: string; quantity: string; unit: string }> = [];

describe('readBulkInput', () => {
  it('keeps nonempty lines in order and ignores blank lines and carriage returns', () => {
    expect(readBulkInput('2 gallons milk\r\n\r\n  \n1 loaf bread\n3 apples\n')).toEqual({
      lines: ['2 gallons milk', '1 loaf bread', '3 apples'],
      error: null
    });
  });

  it('rejects empty and whitespace-only input', () => {
    expect(readBulkInput('')).toEqual({ lines: [], error: 'empty' });
    expect(readBulkInput(' \n\t\n')).toEqual({ lines: [], error: 'empty' });
  });

  it('accepts the maximum number of nonempty lines and rejects one more', () => {
    const allowed = Array.from({ length: MAX_BULK_LINES }, (_, index) => `synthetic item ${index}`).join('\n');
    expect(readBulkInput(allowed).error).toBeNull();
    expect(readBulkInput(allowed).lines).toHaveLength(MAX_BULK_LINES);

    const tooMany = `${allowed}\nsynthetic item extra`;
    expect(readBulkInput(tooMany)).toEqual({ lines: [], error: 'too_many' });
  });

  it('rejects input above the total size limit before splitting it', () => {
    expect(readBulkInput('x'.repeat(MAX_BULK_INPUT_CHARS + 1))).toEqual({ lines: [], error: 'too_large' });
  });
});

describe('buildBulkReview', () => {
  it('reuses the conservative parser for confident quantities and units', () => {
    const review = buildBulkReview(
      ['2 gallons milk', '1 loaf bread', '3 apples', '1/2 lb cheddar cheese', 'Fresh basil'],
      noActive
    );

    expect(review.items).toMatchObject([
      { key: bulkItemKey(0), line: '2 gallons milk', name: 'milk', quantity: '2', unit: 'gallons', needsReview: false, action: 'add' },
      { key: bulkItemKey(1), line: '1 loaf bread', name: '1 loaf bread', quantity: '', unit: '', needsReview: true, action: 'add' },
      { key: bulkItemKey(2), line: '3 apples', name: 'apples', quantity: '3', unit: '', needsReview: false, action: 'add' },
      { key: bulkItemKey(3), line: '1/2 lb cheddar cheese', name: 'cheddar cheese', quantity: '1/2', unit: 'lb', needsReview: false, action: 'add' },
      { key: bulkItemKey(4), line: 'Fresh basil', name: 'Fresh basil', quantity: '', unit: '', needsReview: false, action: 'add' }
    ]);
    expect(review).toMatchObject({ toAdd: 5, toSkip: 0 });
    expect(review.items.every(item => item.existing === null && !item.duplicateOfBatch)).toBe(true);
  });

  it('keeps ambiguous lines whole instead of inventing a quantity or dropping details', () => {
    const review = buildBulkReview(
      ['2 (15 oz) cans tomatoes', 'Salt to taste', '1–2 handfuls spinach', 'about 2 cups beans'],
      noActive
    );

    expect(review.items[0]).toMatchObject({ name: '2 (15 oz) cans tomatoes', quantity: '', unit: '', needsReview: true });
    expect(review.items[1]).toMatchObject({ name: 'Salt to taste', quantity: '', unit: '', needsReview: false });
    expect(review.items[2]).toMatchObject({ name: '1–2 handfuls spinach', quantity: '', unit: '', needsReview: true });
    expect(review.items[3]).toMatchObject({ name: 'about 2 cups beans', quantity: '', unit: '', needsReview: true });
    expect(review.items.map(item => item.line)).toEqual(['2 (15 oz) cans tomatoes', 'Salt to taste', '1–2 handfuls spinach', 'about 2 cups beans']);
  });

  it('defaults probable existing grocery matches to skip without changing the existing item', () => {
    const active = [{ id: 'milk-id', name: 'milk', quantity: '1', unit: 'gallon' }];
    const review = buildBulkReview(['2 gallons milk', '3 apples'], active);

    expect(review.items[0]).toMatchObject({
      name: 'milk',
      action: 'skip',
      existing: { id: 'milk-id', name: 'milk', quantity: '1', unit: 'gallon' }
    });
    expect(review.items[1]).toMatchObject({ name: 'apples', action: 'add', existing: null });
    expect(review).toMatchObject({ toAdd: 1, toSkip: 1 });
    expect(active).toEqual([{ id: 'milk-id', name: 'milk', quantity: '1', unit: 'gallon' }]);
  });

  it('recognises a legacy row that still stores a complete ingredient line', () => {
    const active = [{ id: 'legacy-id', name: '2 cups black beans', quantity: '', unit: '' }];
    const review = buildBulkReview(['2 cups black beans'], active);
    expect(review.items[0]).toMatchObject({ name: 'black beans', action: 'skip', existing: { id: 'legacy-id' } });
  });

  it('marks later duplicate names in the same batch and defaults them to skip', () => {
    const review = buildBulkReview(['2 apples', '3 apples', 'apple', '2 pears'], noActive);

    expect(review.items.map(item => item.duplicateOfBatch)).toEqual([false, true, true, false]);
    expect(review.items.map(item => item.action)).toEqual(['add', 'skip', 'skip', 'add']);
    expect(review).toMatchObject({ toAdd: 2, toSkip: 2 });
  });

  it('does not treat genuinely different products as duplicates of each other', () => {
    const review = buildBulkReview(['2 green apples', '2 red apples', 'olive oil', 'oil'], noActive);
    expect(review.items.map(item => item.duplicateOfBatch)).toEqual([false, false, false, false]);
  });

  it('preserves edited proposals and explicit skip decisions', () => {
    const review = buildBulkReview(['1 loaf bread', '2 cups rice'], noActive, {
      [bulkItemKey(0)]: { name: 'sourdough bread', quantity: '1', unit: 'loaf', action: 'add' },
      [bulkItemKey(1)]: { name: 'rice', quantity: '2', unit: 'cups', action: 'skip' }
    });

    expect(review.items).toMatchObject([
      { key: bulkItemKey(0), line: '1 loaf bread', name: 'sourdough bread', quantity: '1', unit: 'loaf', needsReview: true, action: 'add' },
      { key: bulkItemKey(1), line: '2 cups rice', name: 'rice', quantity: '2', unit: 'cups', needsReview: false, action: 'skip' }
    ]);
    expect(review).toMatchObject({ toAdd: 1, toSkip: 1 });
  });

  it('re-evaluates matches against edited names', () => {
    const active = [{ id: 'rice-id', name: 'rice', quantity: '', unit: '' }];
    const unchanged = buildBulkReview(['2 cups rice'], active);
    expect(unchanged.items[0]).toMatchObject({ action: 'skip', existing: { id: 'rice-id' } });

    const edited = buildBulkReview(['2 cups rice'], active, {
      [bulkItemKey(0)]: { name: 'sourdough rice', quantity: '2', unit: 'cups' }
    });
    expect(edited.items[0]).toMatchObject({ name: 'sourdough rice', action: 'add', existing: null });
  });

  it('keeps an explicitly chosen add visible when the submitted name still matches', () => {
    const active = [{ id: 'rice-id', name: 'rice', quantity: '', unit: '' }];
    const review = buildBulkReview(['2 cups rice'], active, {
      [bulkItemKey(0)]: { action: 'add', name: 'rice', quantity: '2', unit: 'cups' }
    });
    expect(review.items[0]).toMatchObject({ action: 'add', existing: { id: 'rice-id' } });
  });

  it('renders an empty edited name for recovery without inventing a match', () => {
    const active = [{ id: 'rice-id', name: 'rice', quantity: '', unit: '' }];
    const review = buildBulkReview(['2 cups rice'], active, {
      [bulkItemKey(0)]: { action: 'add', name: '   ', quantity: '4', unit: 'bags' }
    });
    expect(review.items[0]).toMatchObject({ name: '   ', quantity: '4', unit: 'bags', existing: null, action: 'add' });
  });

  it('clears an existing match when a bare line is renamed to a different product', () => {
    const active = [{ id: 'milk-id', name: 'milk', quantity: '1', unit: 'gallon' }];
    const edited = buildBulkReview(['milk'], active, {
      [bulkItemKey(0)]: { name: 'almond milk', quantity: '1', unit: 'carton' }
    });
    expect(edited.items[0]).toMatchObject({ name: 'almond milk', existing: null, action: 'add' });
  });

  it('does not flag later rows as batch duplicates when an earlier matching row is skipped', () => {
    const review = buildBulkReview(['2 apples', '3 apples', 'apple'], noActive, {
      [bulkItemKey(0)]: { action: 'skip' }
    });
    expect(review.items.map(item => ({ action: item.action, duplicateOfBatch: item.duplicateOfBatch }))).toEqual([
      { action: 'skip', duplicateOfBatch: false },
      { action: 'add', duplicateOfBatch: false },
      { action: 'skip', duplicateOfBatch: true }
    ]);
  });
});
