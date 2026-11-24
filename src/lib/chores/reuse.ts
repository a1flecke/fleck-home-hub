import { occurrenceDates } from './recurrence';

export const REUSE_MAX_CHILDREN = 20;

export type ReuseFieldsInput = { title: string; description?: string | null; dueDate: string; rewardCents?: number | null };
export type ReuseFields = { title: string; description: string | null; dueDate: string; rewardCents: number | null };
export type ReuseChild = { id: string; name: string };
export type ReuseRow = ReuseFields & { childId: string; childName: string };

export function normalizeReuseFields(input: ReuseFieldsInput): ReuseFields {
  const title = input.title.trim();
  const description = input.description?.trim() || null;
  const rewardCents = input.rewardCents ?? null;
  if (!title || title.length > 120) throw new Error('Invalid reuse title');
  if (description && description.length > 1000) throw new Error('Invalid reuse description');
  occurrenceDates(input.dueDate, input.dueDate, [0]);
  if (rewardCents !== null && (!Number.isSafeInteger(rewardCents) || rewardCents < 0 || rewardCents > 100000000)) throw new Error('Invalid reuse reward');
  return { title, description, dueDate: input.dueDate, rewardCents };
}

export function uniqueAssigneeIds(ids: readonly string[]): string[] {
  const unique = [...new Set(ids.map(id => id.trim()).filter(Boolean))];
  if (!unique.length) throw new Error('Choose at least one child');
  if (unique.length > REUSE_MAX_CHILDREN) throw new Error('Choose fewer children');
  return unique;
}

export function isValidReuseKey(key: string): boolean {
  return /^[A-Za-z0-9-]{16,100}$/.test(key);
}

/** One independent row per selected child, in the child order the parent reviewed. */
export function reusePreviewRows(fields: ReuseFields, children: readonly ReuseChild[]): ReuseRow[] {
  return children.map(child => ({ childId: child.id, childName: child.name, ...fields }));
}
