export const GROCERY_REFRESH_INTERVAL_MS = 25_000;
export const GROCERY_REFRESH_TIMEOUT_MS = 8_000;
export const GROCERY_DATA_PATH = '/groceries/data';

export type GroceryDraft = { name: string; quantity: string; unit: string };

export type GroceryLiveItem = GroceryDraft & {
  id: string;
  completed: boolean;
  version: number;
};

export type GroceryRefreshStatus = 'ok' | 'transient' | 'unauthenticated' | 'forbidden';

export function groceryDraftIsDirty(draft: GroceryDraft, saved: GroceryDraft): boolean {
  return draft.name !== saved.name || draft.quantity !== saved.quantity || draft.unit !== saved.unit;
}

export function groceryAddDraftExists(draft: GroceryDraft & { allowDuplicate: boolean }): boolean {
  return draft.name !== '' || draft.quantity !== '' || draft.unit !== '' || draft.allowDuplicate;
}

/**
 * Classifies a refresh response before any body is parsed. A followed sign-in
 * redirect is HTML, not grocery JSON, so it must end the session rather than
 * look like a successful update.
 */
export function classifyGroceryRefreshResponse(status: number, contentType: string | null, redirected: boolean, url: string): GroceryRefreshStatus {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status < 200 || status >= 300) return 'transient';
  if (!contentType?.toLowerCase().includes('application/json')) {
    return redirected || url.includes('/sign-in') ? 'unauthenticated' : 'transient';
  }
  return 'ok';
}

export type GroceryEditVersion = {
  version: number;
  completed: boolean;
};

export function resolveEditFormVersion(
  formEdit: (GroceryEditVersion & { id: string }) | undefined,
  snapshot: GroceryEditVersion | undefined,
  item: GroceryEditVersion & { id: string }
): GroceryEditVersion {
  if (formEdit?.id === item.id) return { version: formEdit.version, completed: formEdit.completed };
  if (snapshot) return { version: snapshot.version, completed: snapshot.completed };
  return { version: item.version, completed: item.completed };
}

export function shouldApplyGroceryRefresh(state: {
  disposed: boolean;
  authorizationLost: boolean;
  startedVersion: number;
  currentVersion: number;
}): boolean {
  return !state.disposed && !state.authorizationLost && state.startedVersion === state.currentVersion;
}

/** Rejects a malformed payload instead of replacing the displayed list with it. */
export function parseGroceryItems(payload: unknown): GroceryLiveItem[] | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;
  const parsed: GroceryLiveItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const value = item as Record<string, unknown>;
    if (typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.quantity !== 'string' ||
        typeof value.unit !== 'string' || typeof value.completed !== 'boolean' || typeof value.version !== 'number') return null;
    parsed.push({
      id: value.id,
      name: value.name,
      quantity: value.quantity,
      unit: value.unit,
      completed: value.completed,
      version: value.version
    });
  }
  return parsed;
}
