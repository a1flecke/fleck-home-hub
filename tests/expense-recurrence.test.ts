import { expect, it } from 'vitest';
import { expenseDates } from '../src/lib/expenses/recurrence';

it('keeps the monthly anchor after shorter months', () => {
  expect(expenseDates('2026-01-31', 'monthly', '2026-01-01', '2026-03-31')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  expect(expenseDates('2026-01-30', 'monthly', '2026-02-01', '2026-03-31')).toEqual(['2026-02-28', '2026-03-30']);
});

it('returns weekly and biweekly dates within the requested range', () => {
  expect(expenseDates('2026-01-01', 'weekly', '2026-01-08', '2026-01-22')).toEqual(['2026-01-08', '2026-01-15', '2026-01-22']);
  expect(expenseDates('2026-01-01', 'biweekly', '2026-01-08', '2026-01-31')).toEqual(['2026-01-15', '2026-01-29']);
});

it('restores a leap day in leap years', () => {
  expect(expenseDates('2024-02-29', 'yearly', '2027-02-01', '2027-03-01')).toEqual(['2027-02-28']);
  expect(expenseDates('2024-02-29', 'yearly', '2028-02-01', '2028-03-01')).toEqual(['2028-02-29']);
});

it('returns one-off dates only when inside the range', () => {
  expect(expenseDates('2026-01-15', 'once', '2026-01-01', '2026-01-31')).toEqual(['2026-01-15']);
  expect(expenseDates('2026-02-15', 'once', '2026-01-01', '2026-01-31')).toEqual([]);
});

it('rejects invalid dates, reversed ranges, and ranges over the limit', () => {
  expect(() => expenseDates('2026-02-30', 'monthly', '2026-01-01', '2026-03-01')).toThrow();
  expect(() => expenseDates('2026-01-01', 'weekly', '2026-02-01', '2026-01-01')).toThrow();
  expect(() => expenseDates('2026-01-01', 'weekly', '2026-01-01', '2027-01-01')).toThrow();
});
