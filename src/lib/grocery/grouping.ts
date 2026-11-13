export type GroceryGroupName = 'toBuy' | 'bought';

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
