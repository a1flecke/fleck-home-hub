import { cleanRecipeTitle, parseRecipeLink } from './recipe-link';

export type RecipeIngredientGroup = { name: string; lines: string[] };
export type RecipeDetails = {
  sourceUrl: string;
  title: string | null;
  yield: string | null;
  totalTime: string | null;
  groups: RecipeIngredientGroup[];
};

const maxGroups = 10;
const maxLinesPerGroup = 100;
const maxTotalLines = 200;

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const cleaned = cleanRecipeTitle(String(value));
  return cleaned ? cleaned.slice(0, max) : null;
}

function source(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return parseRecipeLink(value)?.url ?? null;
}

/** Normalizes data received from the preview service or a submitted hidden field. */
export function normalizeRecipeDetails(value: unknown): RecipeDetails | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const sourceUrl = source(record.sourceUrl);
  if (!sourceUrl) return null;
  const title = text(record.title, 200), recipeYield = text(record.recipeYield ?? record.yield, 120), totalTime = text(record.totalTime, 80);
  const groups: RecipeIngredientGroup[] = [];
  let totalLines = 0;
  if (Array.isArray(record.groups)) {
    for (const raw of record.groups) {
      if (groups.length >= maxGroups || totalLines >= maxTotalLines) break;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const group = raw as Record<string, unknown>;
      const name = text(group.name, 120) ?? 'Ingredients';
      if (!Array.isArray(group.lines)) continue;
      const lines: string[] = [];
      for (const line of group.lines) {
        if (lines.length >= maxLinesPerGroup || totalLines >= maxTotalLines) break;
        const cleaned = text(line, 500);
        if (cleaned) { lines.push(cleaned); totalLines++; }
      }
      if (lines.length) groups.push({ name, lines });
    }
  }
  if (!title && !recipeYield && !totalTime && !groups.length) return null;
  return { sourceUrl, title, yield: recipeYield, totalTime, groups };
}

export function parseRecipeDetailsJson(raw: string | null | undefined): RecipeDetails | null {
  if (!raw) return null;
  try { return normalizeRecipeDetails(JSON.parse(raw)); } catch { return null; }
}

export function serializeRecipeDetails(details: RecipeDetails | null): string | null {
  return details ? JSON.stringify(details) : null;
}

/** Returns details only when they belong to the meal's exact recognized eMeals link. */
export function recipeDetailsForMeal(details: RecipeDetails | null, recipeUrl: string | null | undefined): RecipeDetails | null {
  if (!details) return null;
  const link = parseRecipeLink(recipeUrl);
  if (!link || link.provider?.id !== 'emeals' || details.sourceUrl !== link.url) return null;
  return details;
}

export function providerIngredientLines(details: RecipeDetails | null): string[] {
  if (!details) return [];
  return details.groups.flatMap(group => group.lines);
}
