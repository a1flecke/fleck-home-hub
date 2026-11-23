import { describe, expect, it } from 'vitest';
import { isValidReuseKey, normalizeReuseFields, reusePreviewRows, uniqueAssigneeIds } from '../src/lib/chores/reuse';

describe('chore reuse rules', () => {
  it('normalizes copied fields and validates the shared batch values', () => {
    expect(normalizeReuseFields({ title: '  Clean bedroom  ', description: '  Vacuum  ', dueDate: '2026-11-28', rewardCents: 250 }))
      .toEqual({ title: 'Clean bedroom', description: 'Vacuum', dueDate: '2026-11-28', rewardCents: 250 });
    expect(normalizeReuseFields({ title: 'No reward', description: '', dueDate: '2026-11-28', rewardCents: null }))
      .toEqual({ title: 'No reward', description: null, dueDate: '2026-11-28', rewardCents: null });
    expect(() => normalizeReuseFields({ title: '   ', description: '', dueDate: '2026-11-28' })).toThrow();
    expect(() => normalizeReuseFields({ title: 'x'.repeat(121), description: '', dueDate: '2026-11-28' })).toThrow();
    expect(() => normalizeReuseFields({ title: 'Title', description: 'x'.repeat(1001), dueDate: '2026-11-28' })).toThrow();
    expect(() => normalizeReuseFields({ title: 'Title', description: '', dueDate: '2026-02-30' })).toThrow();
    expect(() => normalizeReuseFields({ title: 'Title', description: '', dueDate: '2026-11-28', rewardCents: -1 })).toThrow();
    expect(() => normalizeReuseFields({ title: 'Title', description: '', dueDate: '2026-11-28', rewardCents: 1.5 })).toThrow();
  });

  it('deduplicates assignees, requires at least one and bounds the batch', () => {
    expect(uniqueAssigneeIds(['kid', 'sibling', 'kid'])).toEqual(['kid', 'sibling']);
    expect(() => uniqueAssigneeIds([])).toThrow();
    expect(() => uniqueAssigneeIds(['   '])).toThrow();
    expect(() => uniqueAssigneeIds(Array.from({ length: 21 }, (_, index) => `kid-${index}`))).toThrow();
  });

  it('builds one independent preview row per selected child', () => {
    expect(reusePreviewRows(
      { title: 'Clean bedroom', description: 'Vacuum', dueDate: '2026-11-28', rewardCents: 250 },
      [{ id: 'kid', name: 'Kid' }, { id: 'sibling', name: 'Sibling' }]
    )).toEqual([
      { childId: 'kid', childName: 'Kid', title: 'Clean bedroom', description: 'Vacuum', dueDate: '2026-11-28', rewardCents: 250 },
      { childId: 'sibling', childName: 'Sibling', title: 'Clean bedroom', description: 'Vacuum', dueDate: '2026-11-28', rewardCents: 250 }
    ]);
  });

  it('accepts only bounded idempotency keys', () => {
    expect(isValidReuseKey('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isValidReuseKey('short')).toBe(false);
    expect(isValidReuseKey('x'.repeat(101))).toBe(false);
    expect(isValidReuseKey('has spaces in the key value')).toBe(false);
  });
});
