export const GROCERY_REFRESH_INTERVAL_MS = 25_000;

export type GroceryDraft = { name: string; quantity: string; unit: string };

export function groceryDraftIsDirty(draft: GroceryDraft, saved: GroceryDraft): boolean {
  return draft.name !== saved.name || draft.quantity !== saved.quantity || draft.unit !== saved.unit;
}

export function groceryAddDraftExists(draft: GroceryDraft & { allowDuplicate: boolean }): boolean {
  return draft.name !== '' || draft.quantity !== '' || draft.unit !== '' || draft.allowDuplicate;
}
