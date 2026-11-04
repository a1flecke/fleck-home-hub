import { recipeSourceForHost, type RecipeSource } from './recipe-sources';

export type RecipeLink = {
  url: string;
  provider: RecipeSource | null;
  suggestedTitle: string | null;
};

export type RecipeAttribution = {
  url: string | null;
  linkLabel: string | null;
  credit: string | null;
  verifiedSource: RecipeSource | null;
  enteredSource: string | null;
};

const ignoredTitleSegments = new Set(['recipe', 'recipes', 'meal-plan', 'meal-plans', 'menu', 'menus']);

/** Removes control characters and normalizes whitespace without altering printable text. */
export function cleanRecipeTitle(value: string): string {
  return Array.from(value)
    .filter(character => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function isOpaqueTitle(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const compact = trimmed.replace(/[-_\s]/g, '');
  if (!compact || /^\d+$/.test(compact)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return true;
  if (/^[0-9a-f]{16,}$/i.test(compact)) return true;
  if ((trimmed.match(/[A-Za-z]/g) ?? []).length < 3) return true;
  return !/[-_\s]/.test(trimmed) && /\d/.test(trimmed) && trimmed.length >= 6;
}

function suggestedTitle(url: URL, provider: RecipeSource | null): string | null {
  if (url.pathname.endsWith('/')) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  if (!segments.length) return null;
  let segment: string;
  try { segment = decodeURIComponent(segments[segments.length - 1]); } catch { return null; }
  segment = segment.replace(/\.(?:html?|php|aspx?)$/i, '');
  for (const prefix of provider?.titlePrefixes ?? []) segment = segment.replace(prefix, '');
  if (isOpaqueTitle(segment) || ignoredTitleSegments.has(segment.toLowerCase())) return null;
  const text = cleanRecipeTitle(segment
    .replace(/[+_]+/g, ' ')
    .replace(/-+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2'));
  if (text.length < 2 || text.length > 120 || isOpaqueTitle(text)) return null;
  return text.split(' ').map(word => {
    if (word.length > 1 && word === word.toUpperCase()) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

/** Validates an HTTPS recipe link without making any network request. */
export function parseRecipeLink(raw: string | null | undefined): RecipeLink | null {
  const value = raw?.trim();
  if (!value || value.length > 2048) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname) return null;
  if (url.pathname === '/' || url.pathname === '') return null;
  const provider = recipeSourceForHost(url.hostname);
  return { url: value, provider, suggestedTitle: suggestedTitle(url, provider) };
}

/**
 * The single attribution rule for every meal surface. A typed source never
 * upgrades an unrelated destination to a verified provider credit.
 */
export function recipeAttribution(source: string | null | undefined, recipeUrl: string | null | undefined): RecipeAttribution | null {
  const link = parseRecipeLink(recipeUrl);
  const enteredSource = source?.trim() || null;
  if (link?.provider) {
    const sameName = enteredSource?.toLowerCase() === link.provider.name.toLowerCase();
    return {
      url: link.url,
      linkLabel: link.provider.linkLabel,
      credit: link.provider.creditLabel,
      verifiedSource: link.provider,
      enteredSource: sameName ? null : enteredSource
    };
  }
  if (link) {
    return {
      url: link.url,
      linkLabel: 'View recipe',
      credit: enteredSource ? `Source: ${enteredSource}` : null,
      verifiedSource: null,
      enteredSource
    };
  }
  if (enteredSource) {
    return { url: null, linkLabel: null, credit: `Source: ${enteredSource}`, verifiedSource: null, enteredSource };
  }
  return null;
}

/** Finds the first valid HTTPS link inside text supplied by a share target. */
export function firstHttpsRecipeLink(value: string | null | undefined): string | null {
  if (!value) return null;
  for (const token of value.split(/\s+/)) {
    const candidate = token.replace(/^[<("']+/, '').replace(/[>)"'.,;!?]+$/, '');
    if (!/^https:\/\//i.test(candidate)) continue;
    const link = parseRecipeLink(candidate);
    if (link) return link.url;
  }
  return null;
}
