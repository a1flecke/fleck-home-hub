import { expect, it } from 'vitest';
import { groupReviewItems, reviewReason } from '../src/lib/chores/review';

const item = (id: string, assigneeId: string, childName: string, submittedAt: string, rewardCents: number | null) => ({ id, assigneeId, childName, submittedAt, rewardCents });

it('requires a non-blank rework reason and trims accepted reasons', () => {
  expect(reviewReason('verify', '')).toBeNull();
  expect(reviewReason('verify', 'ignored')).toBeNull();
  expect(() => reviewReason('rework', '   ')).toThrow('Enter a reason');
  expect(() => reviewReason('rework', 'x'.repeat(1001))).toThrow('1000');
  expect(reviewReason('rework', '  Please dry the dishes  ')).toBe('Please dry the dishes');
});

it('groups submissions by child and submission date without reordering items', () => {
  const groups = groupReviewItems([
    item('a', 'kid', 'Ada', '2026-11-18T09:00:00.000Z', 200),
    item('b', 'kid', 'Ada', '2026-11-18T08:00:00.000Z', 300),
    item('c', 'kid', 'Ada', '2026-11-17T22:00:00.000Z', null),
    item('d', 'sib', 'Ben', '2026-11-18T07:00:00.000Z', 100)
  ]);
  expect(groups.map(group => [group.childName, group.date, group.items.map(entry => entry.id), group.pendingCents])).toEqual([
    ['Ada', '2026-11-18', ['a', 'b'], 500],
    ['Ada', '2026-11-17', ['c'], 0],
    ['Ben', '2026-11-18', ['d'], 100]
  ]);
});

it('uses a deterministic fallback date when a legacy submission has no transition timestamp', () => {
  const groups = groupReviewItems([{ ...item('legacy', 'kid', 'Ada', '', 200), updatedAt: '2026-11-16T12:00:00.000Z' }]);
  expect(groups[0].date).toBe('2026-11-16');
});

it('allows grouping by a household-local submission date', () => {
  const groups = groupReviewItems([
    item('late', 'kid', 'Ada', '2026-11-18T02:30:00.000Z', 200),
    item('earlier', 'kid', 'Ada', '2026-11-18T00:30:00.000Z', 200)
  ], value => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)));
  expect(groups.map(group => group.date)).toEqual(['2026-11-17']);
  expect(groups[0].items.map(entry => entry.id)).toEqual(['late', 'earlier']);
});
