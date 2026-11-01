import { describe, expect, it } from 'vitest';
import { recipeLinkLabel } from '../src/lib/meals/recipe-link';

describe('recipe link label', () => {
  it('identifies a user-provided eMeals source without depending on capitalization', () => {
    expect(recipeLinkLabel(' eMEALS ')).toBe('Open in eMeals');
  });

  it('keeps a generic label for other or missing sources', () => {
    expect(recipeLinkLabel('Family cookbook')).toBe('View recipe');
    expect(recipeLinkLabel(null)).toBe('View recipe');
    expect(recipeLinkLabel('eMeals-inspired')).toBe('View recipe');
  });
});
