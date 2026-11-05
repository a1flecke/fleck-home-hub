import { normalizeRecipeDetails, type RecipeDetails } from '../meals/recipe-details';
import { parseRecipeLink } from '../meals/recipe-link';

export type RecipePreviewResult =
  | { status: 'ok'; details: RecipeDetails }
  | { status: 'unavailable' }
  | { status: 'failed' };

const maxBytes = 1_000_000;
const maxRedirects = 3;
const timeoutMs = 5_000;
const userAgent = 'FleckHomeHub/0.1 (private household recipe preview)';
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

/** Fetches and parses one user-shared eMeals recipe link. No cookies, credentials or crawling. */
export async function previewRecipe(rawUrl: string, fetchImpl: typeof fetch = fetch): Promise<RecipePreviewResult> {
  const link = parseRecipeLink(rawUrl);
  if (!link || link.provider?.id !== 'emeals') return { status: 'unavailable' };
  try {
    const html = await fetchRecipeHtml(link.url, fetchImpl);
    const details = extractRecipeDetails(html, link.url);
    return details ? { status: 'ok', details } : { status: 'failed' };
  } catch {
    return { status: 'failed' };
  }
}

async function fetchRecipeHtml(url: string, fetchImpl: typeof fetch): Promise<string> {
  let current = new URL(url);
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    const response = await fetchImpl(current, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      cache: 'no-store',
      headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': userAgent },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (redirectStatuses.has(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirects === maxRedirects) throw new Error('Recipe redirect rejected');
      const next = parseRecipeLink(new URL(location, current).href);
      if (!next || next.provider?.id !== 'emeals') throw new Error('Recipe redirect rejected');
      current = new URL(next.url);
      continue;
    }
    if (!response.ok) throw new Error('Recipe page unavailable');
    const type = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!type.includes('text/html') && !type.includes('application/xhtml+xml')) throw new Error('Recipe page type');
    const length = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(length) && length > maxBytes) throw new Error('Recipe page too large');
    return readLimited(response);
  }
  throw new Error('Recipe redirect rejected');
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('Recipe page too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(merged);
}

function stringValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    const parts = value.map(item => stringValue(item)).filter((item): item is string => !!item);
    return parts.length ? parts.join(', ') : null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned : null;
}

function durationMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1] ?? 0) * 10_080 + Number(match[2] ?? 0) * 1_440 + Number(match[3] ?? 0) * 60 + Number(match[4] ?? 0) + Math.round(Number(match[5] ?? 0) / 60);
  return minutes > 0 ? minutes : null;
}

function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60), minutes = total % 60;
  if (hours && minutes) return `${hours} hr ${minutes} min`;
  return hours ? `${hours} hr` : `${minutes} min`;
}

function formatTime(value: unknown): string | null {
  if (typeof value === 'string' && !/^P/i.test(value.trim())) return stringValue(value);
  const minutes = durationMinutes(value);
  return minutes ? formatMinutes(minutes) : null;
}

function totalTime(recipe: Record<string, unknown>): string | null {
  const total = formatTime(recipe.totalTime);
  if (total) return total;
  const prep = durationMinutes(recipe.prepTime) ?? 0, cook = durationMinutes(recipe.cookTime) ?? 0;
  return prep || cook ? formatMinutes(prep + cook) : null;
}

function ingredientLines(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return values
    .flatMap(item => typeof item === 'string' ? item.split(/\r?\n/) : [])
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 100);
}

function isRecipe(node: Record<string, unknown>): boolean {
  const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
  return types.some(type => typeof type === 'string' && type.toLowerCase() === 'recipe');
}

function collectRecipes(value: unknown, recipes: Record<string, unknown>[]): void {
  if (recipes.length >= 10) return;
  if (Array.isArray(value)) {
    for (const item of value) collectRecipes(item, recipes);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const node = value as Record<string, unknown>;
  if (isRecipe(node)) recipes.push(node);
  if (Array.isArray(node['@graph'])) collectRecipes(node['@graph'], recipes);
}

/** Extracts only title, yield, total time and ingredient lines; directions and images are ignored. */
export function extractRecipeDetails(html: string, sourceUrl: string): RecipeDetails | null {
  const recipes: Record<string, unknown>[] = [];
  const scripts = /<script\b[^>]*\btype\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scripts)) {
    try { collectRecipes(JSON.parse(match[1]), recipes); } catch { /* Ignore malformed blocks. */ }
    if (recipes.length >= 10) break;
  }
  if (!recipes.length) return null;
  const first = recipes[0];
  const groups = recipes
    .map(recipe => ({ name: stringValue(recipe.name) ?? stringValue(recipe.headline) ?? 'Ingredients', lines: ingredientLines(recipe.recipeIngredient) }))
    .filter(group => group.lines.length);
  return normalizeRecipeDetails({
    sourceUrl,
    title: stringValue(first.name) ?? stringValue(first.headline),
    yield: stringValue(first.recipeYield),
    totalTime: totalTime(first),
    groups
  });
}
