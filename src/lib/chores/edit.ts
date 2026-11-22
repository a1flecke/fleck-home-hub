import { occurrenceDates } from './recurrence';

export type ChoreEditInput = {
  title: string;
  description?: string | null;
  assigneeId: string;
  dueDate: string;
  rewardCents?: number | null;
};

export type NormalizedChoreEdit = {
  title: string;
  description: string | null;
  assigneeId: string;
  dueDate: string;
  rewardCents: number | null;
};

export type ChoreChange = Record<string, { from: string | number | null; to: string | number | null }>;

export function normalizeChoreEdit(input: ChoreEditInput): NormalizedChoreEdit {
  const title = input.title.trim();
  const description = input.description?.trim() || null;
  const assigneeId = input.assigneeId.trim();
  const rewardCents = input.rewardCents ?? null;
  if (!title || title.length > 120) throw new Error('Invalid chore title');
  if (description && description.length > 1000) throw new Error('Invalid chore description');
  if (!assigneeId) throw new Error('Invalid chore assignee');
  occurrenceDates(input.dueDate, input.dueDate, [0]);
  if (rewardCents !== null && (!Number.isSafeInteger(rewardCents) || rewardCents < 0 || rewardCents > 100000000)) throw new Error('Invalid chore reward');
  return { title, description, assigneeId, dueDate: input.dueDate, rewardCents };
}

/** The audit payload contains only values that actually changed. */
export function changesBetween(current: NormalizedChoreEdit, next: NormalizedChoreEdit): ChoreChange | null {
  const changes: ChoreChange = {};
  for (const field of ['title', 'description', 'assigneeId', 'dueDate', 'rewardCents'] as const) {
    if (current[field] !== next[field]) changes[field] = { from: current[field], to: next[field] };
  }
  return Object.keys(changes).length ? changes : null;
}
