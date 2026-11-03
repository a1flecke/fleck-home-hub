import { describe, expect, it } from 'vitest';
import { firstHttpsRecipeLink, parseRecipeLink, recipeAttribution } from '../src/lib/meals/recipe-link';
import { recipeSourceForHost } from '../src/lib/meals/recipe-sources';

const emealsRecipe = 'https://emeals.com/recipes/644ab3a45f696470b084b00f/62a077a0/sage-garlic-butter-chicken';

describe('recipe source registry', () => {
  it('recognizes only exact eMeals hosts', () => {
    expect(recipeSourceForHost('emeals.com')?.id).toBe('emeals');
    expect(recipeSourceForHost('www.emeals.com')?.id).toBe('emeals');
    expect(recipeSourceForHost('EMEALS.COM')?.id).toBe('emeals');
    expect(recipeSourceForHost('emeals.com.attacker.test')).toBeNull();
    expect(recipeSourceForHost('notemeals.com')).toBeNull();
    expect(recipeSourceForHost('emeals.com.')).toBeNull();
    expect(recipeSourceForHost('app.emeals.com')).toBeNull();
  });
});

describe('recipe link parsing', () => {
  it('recognizes an approved eMeals recipe and suggests a readable title', () => {
    expect(parseRecipeLink(emealsRecipe)).toEqual({
      url: emealsRecipe,
      provider: expect.objectContaining({ id: 'emeals', name: 'eMeals' }),
      suggestedTitle: 'Sage Garlic Butter Chicken'
    });
  });

  it('recognizes www and keeps query parameters and fragments in the original URL', () => {
    const url = 'https://www.emeals.com/recipes/recipe-44950-287957-GarlicPesto-Shrimp-Pasta?utm_source=share#ingredients';
    expect(parseRecipeLink(url)).toMatchObject({
      url,
      suggestedTitle: 'Garlic Pesto Shrimp Pasta',
      provider: expect.objectContaining({ id: 'emeals' })
    });
  });

  it('never recognizes a lookalike or suffix-matching domain', () => {
    for (const url of [
      'https://emeals.com.attacker.test/recipes/soup',
      'https://notemeals.com/recipes/soup',
      'https://emeals.com.evil.test/recipes/soup'
    ]) {
      expect(parseRecipeLink(url)?.provider).toBeNull();
      expect(recipeAttribution('eMeals', url)).toMatchObject({
        credit: 'Source: eMeals',
        linkLabel: 'View recipe',
        verifiedSource: null
      });
    }
  });

  it('rejects insecure, credentialed, malformed, root-only and oversized links', () => {
    expect(parseRecipeLink('http://emeals.com/recipes/soup')).toBeNull();
    expect(parseRecipeLink('https://user:password@emeals.com/recipes/soup')).toBeNull();
    expect(parseRecipeLink('https://emeals.com:8443/recipes/soup')).toBeNull();
    expect(parseRecipeLink('not a url')).toBeNull();
    expect(parseRecipeLink('https://emeals.com/')).toBeNull();
    expect(parseRecipeLink('')).toBeNull();
    expect(parseRecipeLink(null)).toBeNull();
    expect(parseRecipeLink(`https://emeals.com/recipes/${'a'.repeat(2048)}`)).toBeNull();
  });

  it('does not manufacture a title from an opaque path', () => {
    for (const url of [
      'https://emeals.com/recipes/644ab3a45f696470b084b00f',
      'https://emeals.com/recipes/12345',
      'https://emeals.com/recipes/abc123',
      'https://emeals.com/recipes/550e8400-e29b-41d4-a716-446655440000'
    ]) {
      const link = parseRecipeLink(url);
      expect(link?.provider?.id).toBe('emeals');
      expect(link?.suggestedTitle).toBeNull();
    }
  });

  it('handles unrelated recipe providers without eMeals attribution', () => {
    expect(parseRecipeLink('https://example.test/recipes/lemon-chickpea-bowls')).toMatchObject({
      provider: null,
      suggestedTitle: 'Lemon Chickpea Bowls'
    });
    expect(recipeAttribution('Family cookbook', 'https://example.test/recipes/lemon-chickpea-bowls')).toMatchObject({
      credit: 'Source: Family cookbook',
      linkLabel: 'View recipe',
      verifiedSource: null
    });
  });

  it('keeps a typed source separate from verified domain recognition', () => {
    expect(recipeAttribution('eMeals', emealsRecipe)).toMatchObject({
      credit: 'Recipe source: eMeals',
      linkLabel: 'Open original recipe on eMeals',
      verifiedSource: expect.objectContaining({ id: 'emeals' }),
      enteredSource: null
    });
    expect(recipeAttribution("Helen's pick", emealsRecipe)).toMatchObject({
      credit: 'Recipe source: eMeals',
      enteredSource: "Helen's pick"
    });
    expect(recipeAttribution('eMeals', 'https://example.test/recipes/soup')).toMatchObject({
      credit: 'Source: eMeals',
      linkLabel: 'View recipe',
      verifiedSource: null
    });
  });

  it('handles missing links and missing sources', () => {
    expect(recipeAttribution('Family cookbook', null)).toMatchObject({
      credit: 'Source: Family cookbook',
      linkLabel: null,
      url: null
    });
    expect(recipeAttribution(null, null)).toBeNull();
    expect(recipeAttribution('', emealsRecipe)?.credit).toBe('Recipe source: eMeals');
  });

  it('decodes readable path text without introducing control characters', () => {
    const link = parseRecipeLink('https://emeals.com/recipes/Mac-%26-Cheese-%3Cb%3E');
    expect(link?.suggestedTitle).toBe('Mac & Cheese <b>');
    expect([...(link?.suggestedTitle ?? '')].every(character => character.charCodeAt(0) > 31)).toBe(true);
  });
});

describe('shared recipe text extraction', () => {
  it('finds the first valid HTTPS recipe link in shared text', () => {
    expect(firstHttpsRecipeLink('Sage chicken https://emeals.com/recipes/sage-chicken next')).toBe('https://emeals.com/recipes/sage-chicken');
    expect(firstHttpsRecipeLink('<https://emeals.com/recipes/sage-chicken>.')).toBe('https://emeals.com/recipes/sage-chicken');
  });

  it('ignores insecure and non-recipe text', () => {
    expect(firstHttpsRecipeLink('http://emeals.com/recipes/sage-chicken')).toBeNull();
    expect(firstHttpsRecipeLink('javascript:alert(1)')).toBeNull();
    expect(firstHttpsRecipeLink('no link here')).toBeNull();
    expect(firstHttpsRecipeLink(null)).toBeNull();
  });
});
