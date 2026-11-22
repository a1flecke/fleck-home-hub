import { describe, expect, it } from 'vitest';
import { changesBetween, normalizeChoreEdit } from '../src/lib/chores/edit';

const current = {
  title: 'Clean room',
  description: 'Vacuum and dust',
  assigneeId: 'kid',
  dueDate: '2026-11-21',
  rewardCents: 200
};

describe('chore edit rules', () => {
  it('trims and validates editable fields', () => {
    expect(normalizeChoreEdit({ title: '  Water plants  ', description: '  Kitchen only  ', assigneeId: 'kid', dueDate: '2026-11-22', rewardCents: 0 }))
      .toEqual({ title: 'Water plants', description: 'Kitchen only', assigneeId: 'kid', dueDate: '2026-11-22', rewardCents: 0 });
    expect(normalizeChoreEdit({ title: 'No reward', description: '   ', assigneeId: 'kid', dueDate: '2026-11-22', rewardCents: null }))
      .toEqual({ title: 'No reward', description: null, assigneeId: 'kid', dueDate: '2026-11-22', rewardCents: null });
  });

  it('rejects malformed edits before anything is written', () => {
    expect(() => normalizeChoreEdit({ ...current, title: '   ' })).toThrow();
    expect(() => normalizeChoreEdit({ ...current, title: 'x'.repeat(121) })).toThrow();
    expect(() => normalizeChoreEdit({ ...current, description: 'x'.repeat(1001) })).toThrow();
    expect(() => normalizeChoreEdit({ ...current, dueDate: '2026-02-30' })).toThrow();
    expect(() => normalizeChoreEdit({ ...current, dueDate: '11/21/2026' })).toThrow();
    expect(() => normalizeChoreEdit({ ...current, rewardCents: -1 })).toThrow();
    expect(() => normalizeChoreEdit({ ...current, rewardCents: 3.5 })).toThrow();
    expect(() => normalizeChoreEdit({ ...current, rewardCents: 100_000_001 })).toThrow();
    expect(() => normalizeChoreEdit({ ...current, assigneeId: '' })).toThrow();
  });

  it('records only the fields that changed', () => {
    expect(changesBetween(current, { ...current })).toBeNull();
    expect(changesBetween(current, { ...current, title: 'Clean bedroom', dueDate: '2026-11-22', rewardCents: null })).toEqual({
      title: { from: 'Clean room', to: 'Clean bedroom' },
      dueDate: { from: '2026-11-21', to: '2026-11-22' },
      rewardCents: { from: 200, to: null }
    });
  });
});
