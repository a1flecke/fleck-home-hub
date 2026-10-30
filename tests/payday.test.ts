import { expect, it } from 'vitest';
import { nextPayday } from '../src/lib/earnings/payday';

it('finds the next weekly or biweekly household calendar payday', () => {
  expect(nextPayday('2026-03-07', '2026-03-06', 7)).toBe('2026-03-13');
  expect(nextPayday('2026-03-13', '2026-03-06', 7)).toBe('2026-03-13');
  expect(nextPayday('2028-02-29', '2028-02-25', 14)).toBe('2028-03-10');
  expect(nextPayday('2026-01-01', '2026-01-09', 7)).toBe('2026-01-09');
  expect(() => nextPayday('2026-02-30', '2026-01-01', 7)).toThrow();
});
