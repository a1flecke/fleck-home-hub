export type ReviewAction = 'verify' | 'rework';

export function reviewReason(action: ReviewAction, raw: string): string | null {
  if (action === 'verify') return null;
  const reason = raw.trim();
  if (!reason) throw new Error('Enter a reason for returning this work.');
  if (reason.length > 1000) throw new Error('Keep the reason to 1000 characters or fewer.');
  return reason;
}

export type ReviewGroupItem = {
  id: string;
  assigneeId: string;
  childName: string;
  submittedAt: string;
  updatedAt?: string;
  rewardCents: number | null;
};

export type ReviewGroup<T extends ReviewGroupItem> = {
  key: string;
  childId: string;
  childName: string;
  date: string;
  items: T[];
  pendingCents: number;
};

/** Group already-ordered submissions without changing their order. Missing transition timestamps fall back to the chore update. */
export function groupReviewItems<T extends ReviewGroupItem>(items: readonly T[], dateOf?: (timestamp: string) => string): ReviewGroup<T>[] {
  const groups = new Map<string, ReviewGroup<T>>();
  for (const item of items) {
    const timestamp = item.submittedAt || item.updatedAt || '';
    const date = dateOf ? dateOf(timestamp) : timestamp.slice(0, 10);
    const key = `${item.assigneeId}/${date}`;
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
      group.pendingCents += item.rewardCents ?? 0;
    } else {
      groups.set(key, { key, childId: item.assigneeId, childName: item.childName, date, items: [item], pendingCents: item.rewardCents ?? 0 });
    }
  }
  return [...groups.values()];
}
