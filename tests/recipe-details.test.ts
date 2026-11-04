import { describe, expect, it } from 'vitest';
import { normalizeRecipeDetails, parseRecipeDetailsJson, providerIngredientLines, recipeDetailsForMeal, serializeRecipeDetails } from '../src/lib/meals/recipe-details';

const sourceUrl = 'https://emeals.com/recipes/synthetic-preview';
const valid = {
  sourceUrl,
  title: 'Synthetic Preview Bowl',
  yield: '4 servings',
  totalTime: '25 min',
  groups: [
    { name: 'Synthetic Main', lines: ['1½ cups synthetic rice', '2 Tbsp synthetic oil'] },
    { name: 'Synthetic Side', lines: ['1 synthetic lemon'] }
  ]
};

describe('recipe details normalization', () => {
  it('keeps named groups and quantity text exactly', () => {
    expect(normalizeRecipeDetails(valid)).toEqual(valid);
  });

  it('parses and serializes the stored JSON shape', () => {
    expect(parseRecipeDetailsJson(JSON.stringify(valid))).toEqual(valid);
    expect(serializeRecipeDetails(valid)).toBe(JSON.stringify(valid));
    expect(parseRecipeDetailsJson('not json')).toBeNull();
    expect(parseRecipeDetailsJson('')).toBeNull();
    expect(serializeRecipeDetails(null)).toBeNull();
  });

  it('rejects insecure, credentialed or malformed source URLs', () => {
    expect(normalizeRecipeDetails({ ...valid, sourceUrl: 'http://emeals.com/recipes/synthetic-preview' })).toBeNull();
    expect(normalizeRecipeDetails({ ...valid, sourceUrl: 'https://user:pass@emeals.com/recipes/synthetic-preview' })).toBeNull();
    expect(normalizeRecipeDetails({ ...valid, sourceUrl: 'not a url' })).toBeNull();
    expect(normalizeRecipeDetails({ groups: valid.groups })).toBeNull();
  });

  it('strips control characters and caps names, lines and groups', () => {
    const withControls = normalizeRecipeDetails({
      ...valid,
      title: 'Synthetic\u0000 Bowl',
      groups: [{ name: 'Group', lines: ['line\nwith\tcontrols'] }]
    });
    expect(withControls?.title).toBe('Synthetic Bowl');
    expect(withControls?.groups[0].lines).toEqual(['line with controls']);

    const manyGroups = Array.from({ length: 12 }, (_, index) => ({ name: `Group ${index}`, lines: Array.from({ length: 5 }, (_, line) => `line ${line}`) }));
    const capped = normalizeRecipeDetails({ ...valid, title: 't'.repeat(300), groups: manyGroups });
    expect(capped?.title).toHaveLength(200);
    expect(capped?.groups).toHaveLength(10);

    const manyLines = Array.from({ length: 3 }, (_, index) => ({ name: `Group ${index}`, lines: Array.from({ length: 120 }, (_, line) => `line ${line}`) }));
    const lineCapped = normalizeRecipeDetails({ ...valid, groups: manyLines });
    expect(lineCapped?.groups.reduce((total, group) => total + group.lines.length, 0)).toBe(200);
  });

  it('preserves printable HTML-special characters for safe rendering', () => {
    const details = normalizeRecipeDetails({ ...valid, title: 'Mac & Cheese <b>', groups: [{ name: 'Main & Side', lines: ['1 <synthetic> item'] }] });
    expect(details?.title).toBe('Mac & Cheese <b>');
    expect(details?.groups[0].lines[0]).toBe('1 <synthetic> item');
  });

  it('drops empty groups and unknown fields', () => {
    const details = normalizeRecipeDetails({ ...valid, instructions: ['do not store'], image: 'https://emeals.com/photo.jpg', groups: [{ name: 'Empty', lines: [] }, ...valid.groups] });
    expect(details?.groups).toHaveLength(2);
    expect(JSON.stringify(details)).not.toContain('do not store');
    expect(JSON.stringify(details)).not.toContain('photo.jpg');
  });
});

describe('recipe details source matching', () => {
  it('only returns details for the same eMeals link', () => {
    expect(recipeDetailsForMeal(valid, sourceUrl)).toEqual(valid);
    expect(recipeDetailsForMeal(valid, 'https://emeals.com/recipes/another')).toBeNull();
    expect(recipeDetailsForMeal(valid, 'https://example.test/recipes/synthetic-preview')).toBeNull();
    expect(recipeDetailsForMeal(valid, null)).toBeNull();
    expect(recipeDetailsForMeal(null, sourceUrl)).toBeNull();
  });

  it('flattens provider lines for grocery selection', () => {
    expect(providerIngredientLines(valid)).toEqual(['1½ cups synthetic rice', '2 Tbsp synthetic oil', '1 synthetic lemon']);
    expect(providerIngredientLines(null)).toEqual([]);
  });
});
