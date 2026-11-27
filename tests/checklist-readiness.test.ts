import { expect, it } from 'vitest';
import { checklistFilter, matchesChecklistFilter, summarizeReadiness } from '../src/lib/checklists/readiness';

it('filters the visible items without changing who owns them or whether they are ready', () => {
  const items = [
    { assignedTo: 'self', completed: false },
    { assignedTo: null, completed: false },
    { assignedTo: 'sibling', completed: true },
    { assignedTo: 'self', completed: true }
  ];
  const selected = (filter: string) => items.filter(item => matchesChecklistFilter(checklistFilter(filter), { ...item, mine: item.assignedTo === 'self', unassigned: item.assignedTo === null }));
  expect(selected('my')).toEqual([items[0], items[3]]);
  expect(selected('unassigned')).toEqual([items[1]]);
  expect(selected('todo')).toEqual(items.slice(0, 2));
  expect(selected('completed')).toEqual(items.slice(2));
  expect(selected('unknown')).toEqual(items);
});

it('sums the progress on all visible preparation lists and only calls nonempty preparation ready', () => {
  expect(summarizeReadiness([{ completed: 1, total: 2 }, { completed: 2, total: 2 }]))
    .toEqual({ completed: 3, total: 4, outstanding: 1, ready: false });
  expect(summarizeReadiness([{ completed: 2, total: 2 }]).ready).toBe(true);
  expect(summarizeReadiness([{ completed: 0, total: 0 }]).ready).toBe(false);
});
