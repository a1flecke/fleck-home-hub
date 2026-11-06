import { parseIngredientLine } from './ingredient-parser';

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/[.!?]+$/, '');
}

function singularize(word: string): string {
  if (word.endsWith('ies') && word.length > 3) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes') && word.length > 3) return word.slice(0, -2);
  if (/(?:ches|shes|xes|zes|ses)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 2) return word.slice(0, -1);
  return word;
}

function nameKey(value: string): string {
  const normalized = normalize(value);
  if (!normalized) return '';
  const words = normalized.split(' ');
  words[words.length - 1] = singularize(words[words.length - 1]);
  return words.join(' ');
}

export function sameGroceryName(left: string, right: string): boolean {
  const normalizeValue = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const a = normalizeValue(left), b = normalizeValue(right);
  return a === b || (!!a && !!b && (a.endsWith(` ${b}`) || b.endsWith(` ${a}`)));
}

/**
 * Conservative comparison for reviewing a meal ingredient against an active grocery item.
 * It compares the parsed item name, matches simple singular/plural forms, and can read a
 * legacy row that still stores the complete ingredient line in its name. It never treats
 * one product as another merely because a word appears inside both names.
 */
export function probableGroceryMatch(candidateName: string, existingName: string): boolean {
  const candidate = nameKey(candidateName);
  if (!candidate) return false;
  if (candidate === nameKey(existingName)) return true;
  const legacy = parseIngredientLine(existingName);
  if (legacy.needsReview || legacy.name === legacy.original) return false;
  return candidate === nameKey(legacy.name);
}

export function ingredientLines(ingredients: string): string[] {
  return ingredients.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}
