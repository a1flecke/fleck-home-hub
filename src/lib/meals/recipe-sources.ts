export type RecipeSource = {
  id: string;
  name: string;
  hosts: readonly string[];
  creditLabel: string;
  linkLabel: string;
  titlePrefixes: readonly RegExp[];
};

/**
 * Source recognition is descriptive, not a permission to retrieve provider data.
 * Add a vendor here only with an exact host list and reviewed labels.
 */
export const recipeSources: readonly RecipeSource[] = [
  {
    id: 'emeals',
    name: 'eMeals',
    hosts: ['emeals.com', 'www.emeals.com'],
    creditLabel: 'Recipe source: eMeals',
    linkLabel: 'Open original recipe on eMeals',
    titlePrefixes: [/^recipe-\d+-\d+-/i]
  }
];

export function recipeSourceForHost(hostname: string): RecipeSource | null {
  const host = hostname.trim().toLowerCase();
  return recipeSources.find(source => source.hosts.includes(host)) ?? null;
}
