import { probableGroceryMatch } from './domain';
import { parseIngredientLine, type ParsedIngredient } from './ingredient-parser';

/** One pasted list may contain at most this many nonempty lines. */
export const MAX_BULK_LINES = 30;
/** The complete pasted text is bounded before it is split into lines. */
export const MAX_BULK_INPUT_CHARS = 6000;

export type BulkAction = 'add' | 'skip';

export const bulkActions: readonly BulkAction[] = ['add', 'skip'];

export type BulkMatchSummary = { id: string; name: string; quantity: string; unit: string };

export type BulkReviewItem = ParsedIngredient & {
  key: string;
  line: string;
  existing: BulkMatchSummary | null;
  duplicateOfBatch: boolean;
  action: BulkAction;
  name: string;
  quantity: string;
  unit: string;
};

export type BulkReview = {
  items: BulkReviewItem[];
  toAdd: number;
  toSkip: number;
};

export type BulkDecision = {
  key: string;
  line: string;
  action: BulkAction;
  name: string;
  quantity: string;
  unit: string;
};

export type BulkOverrides = Record<string, Partial<Omit<BulkDecision, 'key' | 'line'>>>;

export type BulkInputError = 'empty' | 'too_many' | 'too_large';

export function bulkItemKey(index: number): string {
  return `bulk:${index}`;
}

/** Splits a pasted list without trusting its size, blank lines or line endings. */
export function readBulkInput(value: string): { lines: string[]; error: BulkInputError | null } {
  if (value.length > MAX_BULK_INPUT_CHARS) return { lines: [], error: 'too_large' };
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return { lines: [], error: 'empty' };
  if (lines.length > MAX_BULK_LINES) return { lines: [], error: 'too_many' };
  return { lines, error: null };
}

function isBulkAction(value: unknown): value is BulkAction {
  return typeof value === 'string' && bulkActions.includes(value as BulkAction);
}

function matchesExisting(name: string, line: string, item: { name: string }): boolean {
  return probableGroceryMatch(name, item.name) || probableGroceryMatch(line, item.name);
}

/**
 * Builds the editable review for a pasted list. Parsing is deliberately conservative:
 * an ambiguous line stays whole and is marked for review, and an existing or
 * within-batch match defaults to skip. Nothing here writes or mutates a grocery row.
 */
export function buildBulkReview(
  lines: string[],
  active: Array<{ id: string; name: string; quantity: string; unit: string }>,
  overrides: BulkOverrides = {}
): BulkReview {
  const seenNames: string[] = [];
  const items = lines.map((line, index) => {
    const key = bulkItemKey(index);
    const parsed = parseIngredientLine(line);
    const override = overrides[key] ?? {};
    const name = override.name ?? parsed.name;
    const quantity = override.quantity ?? parsed.quantity;
    const unit = override.unit ?? parsed.unit;

    const existing = active.find(item => matchesExisting(name, line, item)) ?? null;
    const duplicateOfBatch = name.trim() !== '' && seenNames.some(previous => probableGroceryMatch(name, previous));
    seenNames.push(name);

    const requested = override.action;
    const action: BulkAction = isBulkAction(requested) ? requested : existing || duplicateOfBatch ? 'skip' : 'add';

    return {
      ...parsed,
      key,
      line,
      existing: existing ? { id: existing.id, name: existing.name, quantity: existing.quantity, unit: existing.unit } : null,
      duplicateOfBatch,
      action,
      name,
      quantity,
      unit
    };
  });

  return {
    items,
    toAdd: items.filter(item => item.action === 'add').length,
    toSkip: items.filter(item => item.action === 'skip').length
  };
}
