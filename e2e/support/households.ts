import { expect, type BrowserContext, type Page } from '@playwright/test';
import type { SeededHousehold, SeededMember } from '../../scripts/e2e-seed-server';

export type { SeededHousehold, SeededMember };

const origin = 'http://127.0.0.1:4173';
const seedOrigin = 'http://127.0.0.1:4175';

type FreshHouseholdInput = {
  name?: string;
  members: { name: string; role: 'parent' | 'kid'; disabled?: boolean }[];
  chores?: { key: string; assignee: string; title: string; description?: string; dueDate: string; rewardCents?: number | null; status?: 'todo' | 'pending_verification' | 'needs_rework' | 'verified' }[];
};

/**
 * Creates a brand-new household with its own members and chores through the browser-test seeding
 * service (scripts/e2e-seed-server.ts). Emails, passwords and chore ids are generated per call, so a
 * test built on it never shares records, balances or one-time actions with another test or with a
 * repetition of itself. Member names only need to be unique within the household.
 */
export async function freshHousehold(input: FreshHouseholdInput): Promise<SeededHousehold> {
  const response = await fetch(`${seedOrigin}/households`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const body = await response.json() as SeededHousehold | { error: string };
  if (response.status !== 201 || 'error' in body) throw new Error(`Seeding a fresh household failed (${response.status}): ${'error' in body ? body.error : ''}`);
  return body;
}

/** Signs a browser context in as `member` through the real sign-in API and checks the result. */
export async function signInAs(target: BrowserContext | Page, member: SeededMember): Promise<void> {
  const response = await target.request.post(`${origin}/api/auth/sign-in/email`, { headers: { origin }, data: { email: member.email, password: member.password } });
  expect(response.status(), `sign in ${member.name}`).toBe(member.disabled ? 401 : 200);
}
