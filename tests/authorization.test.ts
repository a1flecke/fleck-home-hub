import { describe, expect, it } from 'vitest';
import { authorize } from '../src/lib/server/authorization';

describe('household authorization', () => {
  it('rejects anonymous access', () => expect(authorize(null, 'home-a', 'read')).toBe(false));
  it('rejects access across households', () => expect(authorize({ householdId: 'home-a', role: 'parent' }, 'home-b', 'read')).toBe(false));
  it('rejects parent actions by children', () => expect(authorize({ householdId: 'home-a', role: 'kid' }, 'home-a', 'manage')).toBe(false));
  it('allows a parent to manage their household', () => expect(authorize({ householdId: 'home-a', role: 'parent' }, 'home-a', 'manage')).toBe(true));
  it('allows a child to read their household', () => expect(authorize({ householdId: 'home-a', role: 'kid' }, 'home-a', 'read')).toBe(true));
});
