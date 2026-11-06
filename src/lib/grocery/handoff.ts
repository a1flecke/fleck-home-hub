import type { ParsedIngredient } from './ingredient-parser';

export type IngredientSource = 'family' | 'provider';
export type IngredientAction = 'add' | 'skip' | 'duplicate';

export const ingredientActions: readonly IngredientAction[] = ['add', 'skip', 'duplicate'];

export type GroceryMatchSummary = { id: string; name: string; quantity: string; unit: string };

export type IngredientReviewItem = ParsedIngredient & {
  key: string;
  line: string;
  source: IngredientSource;
  group: string | null;
  existing: GroceryMatchSummary | null;
  duplicateOfSelection: boolean;
  action: IngredientAction;
  name: string;
  quantity: string;
  unit: string;
};

export type IngredientReview = {
  mealId: string;
  mealTitle: string;
  items: IngredientReviewItem[];
};

export type IngredientDecision = {
  key: string;
  line: string;
  action: IngredientAction;
  name: string;
  quantity: string;
  unit: string;
};

export type IngredientReviewOverrides = Record<string, Partial<Omit<IngredientDecision, 'key' | 'line'>>>;

export function familyIngredientKey(index: number): string {
  return `family:${index}`;
}

export function providerIngredientKey(groupIndex: number, lineIndex: number): string {
  return `provider:${groupIndex}:${lineIndex}`;
}
