export const checklistFilters = [
  ['all', 'All items'],
  ['my', 'My items'],
  ['unassigned', 'Unassigned'],
  ['todo', 'Still to do'],
  ['completed', 'Completed']
] as const;

type ChecklistFilter = (typeof checklistFilters)[number][0];

export function checklistFilter(value: string | null): ChecklistFilter {
  return checklistFilters.find(([filter]) => filter === value)?.[0] ?? 'all';
}

export function matchesChecklistFilter(filter: ChecklistFilter, item: { mine: boolean; unassigned: boolean; completed: boolean }) {
  switch (filter) {
    case 'my': return item.mine;
    case 'unassigned': return item.unassigned;
    case 'todo': return !item.completed;
    case 'completed': return item.completed;
    case 'all': return true;
  }
}

export function summarizeReadiness(lists: readonly { completed: number; total: number }[]) {
  const { completed, total } = lists.reduce(
    (sum, list) => ({ completed: sum.completed + list.completed, total: sum.total + list.total }),
    { completed: 0, total: 0 }
  );
  return { completed, total, outstanding: total - completed, ready: total > 0 && completed === total };
}

export function removedChecklistItemDraft<T extends { id: string }>(
  items: readonly { id: string }[],
  editItem: T | undefined
): T | null {
  if (!editItem) return null;
  return items.some(item => item.id === editItem.id) ? null : editItem;
}
