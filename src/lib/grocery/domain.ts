export function sameGroceryName(left: string, right: string): boolean {
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const a = normalize(left), b = normalize(right);
  return a === b || (!!a && !!b && (a.endsWith(` ${b}`) || b.endsWith(` ${a}`)));
}

export function ingredientLines(ingredients: string): string[] {
  return ingredients.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}
