export type GroceryGroupName = 'toBuy' | 'bought';

/** One request may review at most this many bought rows before clearing. */
export const MAX_BOUGHT_CLEAR_ROWS = 200;

type GroupableGrocery = { id: string; completed: boolean };

/**
 * Partitions the list for shopping. A pin keeps an item in the group where its edit
 * form is open, so a background refresh cannot move the form out from under the member.
 */
export function groupGroceryItems<T extends GroupableGrocery>(items: T[], pinned: Record<string, GroceryGroupName> = {}): { toBuy: T[]; bought: T[] } {
  const toBuy: T[] = [], bought: T[] = [];
  for (const item of items) {
    const group = pinned[item.id] ?? (item.completed ? 'bought' : 'toBuy');
    if (group === 'bought') bought.push(item);
    else toBuy.push(item);
  }
  return { toBuy, bought };
}

/** Bounds a single bought-clear form submission to the server row limit so large lists stay clearable in batches. */
export function boughtClearBatch<T>(bought: readonly T[], limit = MAX_BOUGHT_CLEAR_ROWS): { batch: T[]; remaining: number } {
  const batch = bought.slice(0, limit);
  return { batch, remaining: Math.max(0, bought.length - batch.length) };
}
