import { probableGroceryMatch } from './domain';
import { parseIngredientLine, type ParsedIngredient } from './ingredient-parser';
import type { GroceryMatchSummary, IngredientAction, IngredientReviewOverrides, IngredientSource } from './handoff';

export type WeekIngredientRef = {
  key: string;
  mealId: string;
  mealTitle: string;
  mealDate: string;
  source: IngredientSource;
  group: string | null;
  line: string;
};

export type WeekIngredientRequirement = {
  mealId: string;
  mealTitle: string;
  mealDate: string;
  quantity: string;
  unit: string;
};

export type WeekIngredientReviewItem = ParsedIngredient & {
  key: string;
  line: string;
  source: IngredientSource;
  group: string | null;
  requiredBy: WeekIngredientRequirement[];
  existing: GroceryMatchSummary | null;
  duplicateOfSelection: boolean;
  action: IngredientAction;
  name: string;
  quantity: string;
  unit: string;
};

export type WeekIngredientReview = {
  items: WeekIngredientReviewItem[];
  toAdd: number;
  toSkip: number;
};

function sameLine(left: string, right: string): boolean {
  return left.trim().replace(/\s+/g, ' ').toLowerCase() === right.trim().replace(/\s+/g, ' ').toLowerCase();
}

function sameIngredient(left: ParsedIngredient, right: ParsedIngredient): boolean {
  return (!!left.name.trim() && probableGroceryMatch(left.name, right.name)) || sameLine(left.original, right.original);
}

/**
 * Builds one row per selected ingredient occurrence. Identical or conservatively matching
 * ingredients from another meal stay visible, keep their own quantity and unit, and default to
 * Skip so no quantity is silently combined. A parent can still choose Add for a separate item.
 */
export function buildWeekIngredientReview(
  refs: WeekIngredientRef[],
  active: Array<{ id: string; name: string; quantity: string; unit: string }>,
  overrides: IngredientReviewOverrides = {}
): WeekIngredientReview {
  const parsed = refs.map(ref => ({ ref, value: parseIngredientLine(ref.line) }));
  const seen: ParsedIngredient[] = [];
  const items = parsed.map(({ ref, value }) => {
    const override = overrides[ref.key] ?? {};
    const name = override.name ?? value.name;
    const quantity = override.quantity ?? value.quantity;
    const unit = override.unit ?? value.unit;
    const existing = active.find(item => probableGroceryMatch(value.name, item.name) || probableGroceryMatch(ref.line, item.name)) ?? null;
    const duplicateOfSelection = seen.some(previous => sameIngredient(value, previous));
    seen.push(value);
    const requiredBy = parsed
      .filter(other => sameIngredient(value, other.value))
      .map(other => ({
        mealId: other.ref.mealId,
        mealTitle: other.ref.mealTitle,
        mealDate: other.ref.mealDate,
        quantity: other.value.quantity,
        unit: other.value.unit
      }));

    let action: IngredientAction = override.action ?? (existing || duplicateOfSelection ? 'skip' : 'add');
    if (!existing && action === 'duplicate') action = 'add';
    if (existing && action === 'add') action = 'skip';

    return {
      ...value,
      key: ref.key,
      line: ref.line,
      source: ref.source,
      group: ref.group,
      requiredBy,
      existing: existing ? { id: existing.id, name: existing.name, quantity: existing.quantity, unit: existing.unit } : null,
      duplicateOfSelection,
      action,
      name,
      quantity,
      unit
    };
  });

  return {
    items,
    toAdd: items.filter(item => item.action !== 'skip').length,
    toSkip: items.filter(item => item.action === 'skip').length
  };
}
