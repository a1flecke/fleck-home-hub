import { describe, expect, it } from 'vitest';
import { transition } from '../src/lib/chores/domain';

describe('chore transitions', () => {
  it('moves a child submission to pending without verifying it', () => {
    expect(transition('todo', 'submit', 'kid')).toBe('pending_verification');
  });
  it.each([
    ['needs_rework', 'submit', 'kid', 'pending_verification'],
    ['pending_verification', 'verify', 'parent', 'verified'],
    ['pending_verification', 'rework', 'parent', 'needs_rework']
  ] as const)('permits %s / %s by %s', (state, action, role, expected) => {
    expect(transition(state, action, role)).toBe(expected);
  });
  it.each([
    ['todo', 'verify', 'parent'],
    ['pending_verification', 'verify', 'kid'],
    ['pending_verification', 'rework', 'kid'],
    ['pending_verification', 'submit', 'kid'],
    ['needs_rework', 'verify', 'parent'],
    ['verified', 'submit', 'kid'],
    ['verified', 'rework', 'parent'],
    ['verified', 'verify', 'parent'],
    ['todo', 'submit', 'parent']
  ] as const)('rejects %s / %s by %s', (state, action, role) => {
    expect(() => transition(state, action, role)).toThrow();
  });
});
