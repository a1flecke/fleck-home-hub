import { describe, expect, it } from 'vitest';
import { buildWeekIngredientReview, type WeekIngredientRef } from '../src/lib/grocery/week';

const refs: WeekIngredientRef[] = [
  { key: 'meal-a:family:0', mealId: 'meal-a', mealTitle: 'Monday pasta', mealDate: '2026-11-16', source: 'family', group: null, line: '2 cups rice' },
  { key: 'meal-b:family:0', mealId: 'meal-b', mealTitle: 'Tuesday bowls', mealDate: '2026-11-17', source: 'family', group: null, line: '1 cup rice' },
  { key: 'meal-b:provider:0:0', mealId: 'meal-b', mealTitle: 'Tuesday bowls', mealDate: '2026-11-17', source: 'provider', group: 'Synthetic Main', line: '1 onion' },
  { key: 'meal-c:family:0', mealId: 'meal-c', mealTitle: 'Wednesday soup', mealDate: '2026-11-18', source: 'family', group: null, line: '1 onion' },
  { key: 'meal-c:family:1', mealId: 'meal-c', mealTitle: 'Wednesday soup', mealDate: '2026-11-18', source: 'family', group: null, line: 'Salt to taste' }
];
const active = [{ id: 'g1', name: 'onions', quantity: '3', unit: '' }];

describe('week grocery review', () => {
  it('shows which selected meals require each line without combining quantities', () => {
    const review = buildWeekIngredientReview(refs, active);
    const [riceA, riceB, onionProvider, onionFamily, salt] = review.items;

    expect(riceA).toMatchObject({ line: '2 cups rice', name: 'rice', quantity: '2', unit: 'cups', action: 'add', duplicateOfSelection: false });
    expect(riceA.requiredBy.map(item => item.mealTitle)).toEqual(['Monday pasta', 'Tuesday bowls']);
    expect(riceB).toMatchObject({ line: '1 cup rice', name: 'rice', quantity: '1', unit: 'cup', action: 'skip', duplicateOfSelection: true });
    expect(riceB.requiredBy.map(item => item.mealTitle)).toEqual(['Monday pasta', 'Tuesday bowls']);
    expect(riceB.requiredBy.map(item => `${item.quantity} ${item.unit}`.trim())).toEqual(['2 cups', '1 cup']);

    expect(onionProvider).toMatchObject({ source: 'provider', group: 'Synthetic Main', action: 'skip' });
    expect(onionProvider.existing).toEqual({ id: 'g1', name: 'onions', quantity: '3', unit: '' });
    expect(onionFamily.duplicateOfSelection).toBe(true);
    expect(onionProvider.requiredBy.map(item => item.mealTitle)).toEqual(['Tuesday bowls', 'Wednesday soup']);

    expect(salt).toMatchObject({ line: 'Salt to taste', action: 'add' });
    expect(review.toAdd).toBe(2);
    expect(review.toSkip).toBe(3);
  });

  it('preserves explicit add, skip and duplicate decisions and edited values', () => {
    const review = buildWeekIngredientReview(refs, active, {
      'meal-b:family:0': { action: 'add' },
      'meal-b:provider:0:0': { action: 'duplicate', quantity: '2' },
      'meal-c:family:0': { action: 'skip' }
    });
    const byKey = new Map(review.items.map(item => [item.key, item]));
    expect(byKey.get('meal-b:family:0')).toMatchObject({ action: 'add', quantity: '1' });
    expect(byKey.get('meal-b:provider:0:0')).toMatchObject({ action: 'duplicate', quantity: '2' });
    expect(byKey.get('meal-c:family:0')).toMatchObject({ action: 'skip' });
    expect(byKey.get('meal-a:family:0')?.action).toBe('add');
  });

  it('keeps incompatible units separate and never adds them together', () => {
    const mixed: WeekIngredientRef[] = [
      { key: 'one:family:0', mealId: 'one', mealTitle: 'One', mealDate: '2026-11-16', source: 'family', group: null, line: '2 cups flour' },
      { key: 'two:family:0', mealId: 'two', mealTitle: 'Two', mealDate: '2026-11-17', source: 'family', group: null, line: '500 g flour' }
    ];
    const review = buildWeekIngredientReview(mixed, []);
    expect(review.items.map(item => ({ action: item.action, quantity: item.quantity, unit: item.unit }))).toEqual([
      { action: 'add', quantity: '2', unit: 'cups' },
      { action: 'skip', quantity: '500', unit: 'g' }
    ]);
  });
});
