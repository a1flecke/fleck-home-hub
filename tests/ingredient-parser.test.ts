import { describe, expect, it } from 'vitest';
import { parseIngredientLine, parseIngredientLines } from '../src/lib/grocery/ingredient-parser';

function parsed(line: string) {
  const value = parseIngredientLine(line);
  return { name: value.name, quantity: value.quantity, unit: value.unit, needsReview: value.needsReview };
}

describe('ingredient parsing', () => {
  it('splits integer quantities and common units', () => {
    expect(parsed('2 cups black beans')).toEqual({ name: 'black beans', quantity: '2', unit: 'cups', needsReview: false });
    expect(parsed('3 tbsp olive oil')).toEqual({ name: 'olive oil', quantity: '3', unit: 'tbsp', needsReview: false });
    expect(parsed('1 lb ground beef')).toEqual({ name: 'ground beef', quantity: '1', unit: 'lb', needsReview: false });
    expect(parsed('2 cans diced tomatoes')).toEqual({ name: 'diced tomatoes', quantity: '2', unit: 'cans', needsReview: false });
  });

  it('keeps counted items without inventing a unit', () => {
    expect(parsed('1 onion')).toEqual({ name: 'onion', quantity: '1', unit: '', needsReview: false });
    expect(parsed('4 eggs')).toEqual({ name: 'eggs', quantity: '4', unit: '', needsReview: false });
    expect(parsed('2 avocados')).toEqual({ name: 'avocados', quantity: '2', unit: '', needsReview: false });
  });

  it('supports fractions, mixed numbers and decimals', () => {
    expect(parsed('1/2 tsp salt')).toEqual({ name: 'salt', quantity: '1/2', unit: 'tsp', needsReview: false });
    expect(parsed('1 1/2 cups flour')).toEqual({ name: 'flour', quantity: '1 1/2', unit: 'cups', needsReview: false });
    expect(parsed('1.5 cups milk')).toEqual({ name: 'milk', quantity: '1.5', unit: 'cups', needsReview: false });
  });

  it('supports common Unicode fractions without losing them', () => {
    expect(parsed('½ cup sugar')).toEqual({ name: 'sugar', quantity: '½', unit: 'cup', needsReview: false });
    expect(parsed('⅓ cup cocoa')).toEqual({ name: 'cocoa', quantity: '⅓', unit: 'cup', needsReview: false });
    expect(parsed('1½ cups synthetic rice')).toEqual({ name: 'synthetic rice', quantity: '1½', unit: 'cups', needsReview: false });
  });

  it('leaves an ingredient without a quantity intact', () => {
    expect(parsed('Fresh basil')).toEqual({ name: 'Fresh basil', quantity: '', unit: '', needsReview: false });
    expect(parsed('Salt to taste')).toEqual({ name: 'Salt to taste', quantity: '', unit: '', needsReview: false });
  });

  it('normalizes incidental whitespace without changing the original text', () => {
    const value = parseIngredientLine('  2   cups   black   beans  ');
    expect(value.original).toBe('2   cups   black   beans');
    expect(value).toMatchObject({ name: 'black beans', quantity: '2', unit: 'cups', needsReview: false });
  });

  it('preserves qualifiers and preparation notes in the item name', () => {
    expect(parsed('2 cups organic black beans')).toEqual({ name: 'organic black beans', quantity: '2', unit: 'cups', needsReview: false });
    expect(parsed('1 tsp salt, divided')).toEqual({ name: 'salt, divided', quantity: '1', unit: 'tsp', needsReview: false });
    expect(parsed('2 cups of black beans')).toEqual({ name: 'black beans', quantity: '2', unit: 'cups', needsReview: false });
  });

  it('keeps ambiguous package sizes and parenthetical text in the original line', () => {
    for (const line of ['2 (15 oz) cans diced tomatoes', '1 onion (diced)', '2 bags family lentils', '2 packages cream cheese']) {
      expect(parseIngredientLine(line)).toMatchObject({ name: line, quantity: '', unit: '', needsReview: true });
    }
  });

  it('keeps ranges and approximate amounts in the original line', () => {
    for (const line of ['1–2 handfuls spinach', '1-2 handfuls spinach', 'about 2 cups beans', '2+ cups beans', '2']) {
      expect(parseIngredientLine(line)).toMatchObject({ name: line, quantity: '', unit: '', needsReview: true });
    }
  });

  it('does not invent a unit for unknown measurement abbreviations', () => {
    for (const line of ['2 T butter', '2 pkg. cream cheese', '2 pkg cream cheese']) {
      expect(parseIngredientLine(line)).toMatchObject({ name: line, quantity: '', unit: '', needsReview: true });
    }
  });

  it('never loses the original text when parsing is uncertain', () => {
    for (const line of ['2 (15 oz) cans diced tomatoes', '1–2 handfuls spinach', '2 pkg cream cheese', 'about 2 cups beans']) {
      const value = parseIngredientLine(line);
      expect(value.name).toBe(value.original);
      expect(value.quantity).toBe('');
      expect(value.unit).toBe('');
      expect(value.needsReview).toBe(true);
    }
  });

  it('parses a list and drops blank lines', () => {
    expect(parseIngredientLines('2 cups beans\n\n1 onion\r\n')).toMatchObject([
      { name: 'beans', quantity: '2', unit: 'cups' },
      { name: 'onion', quantity: '1', unit: '' }
    ]);
  });

  it('does not split product names that begin with a number', () => {
    expect(parsed('2% milk')).toEqual({ name: '2% milk', quantity: '', unit: '', needsReview: false });
    expect(parsed('7-Up soda')).toEqual({ name: '7-Up soda', quantity: '', unit: '', needsReview: false });
  });
});
