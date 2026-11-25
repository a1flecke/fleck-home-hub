import { parseIngredientLine } from './ingredient-parser';

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/[.!?]+$/, '');
}

/**
 * Possible singular spellings of a final word. English plural rules are ambiguous without a
 * dictionary ("cookies" -> "cookie", "berries" -> "berry"), so every plausible form is kept and
 * two names match when their sets overlap. Forms come only from a closed list of suffix rules.
 */
function wordForms(word: string): string[] {
  const forms = new Set([word]);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 2) forms.add(word.slice(0, -1));
  if (/(?:ches|shes|xes|zes|sses|oes)$/.test(word)) forms.add(word.slice(0, -2));
  if (word.endsWith('ies') && word.length > 3) forms.add(`${word.slice(0, -3)}y`);
  return [...forms];
}

function nameKeys(value: string): string[] {
  const normalized = normalize(value);
  if (!normalized) return [];
  const words = normalized.split(' ');
  const last = words.pop()!;
  const prefix = words.length ? `${words.join(' ')} ` : '';
  return wordForms(last).map(form => prefix + form);
}

function sameNameKey(left: string, right: string): boolean {
  const keys = new Set(nameKeys(left));
  return nameKeys(right).some(key => keys.has(key));
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
  if (!normalize(candidateName)) return false;
  if (sameNameKey(candidateName, existingName)) return true;
  const legacy = parseIngredientLine(existingName);
  if (legacy.needsReview || legacy.name === legacy.original) return false;
  return sameNameKey(candidateName, legacy.name);
}

/**
 * Matches a reviewed grocery candidate against an active grocery row. When the user has
 * edited the proposed name, only the edited name is compared so renaming clears stale matches
 * and narrowing an ambiguous line detects active conflicts.
 */
export function matchesActiveGrocery(candidateName: string, originalLine: string, existingName: string, nameEdited: boolean): boolean {
  return probableGroceryMatch(candidateName, existingName) || (!nameEdited && probableGroceryMatch(originalLine, existingName));
}

export function ingredientLines(ingredients: string): string[] {
  return ingredients.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}
