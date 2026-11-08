import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const rows = readFileSync('docs/pilot-test-plan.md', 'utf8').split('\n').filter(line => /^\| [A-Z]{3}-\d+ \|/.test(line)).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));

describe('pilot test plan template', () => {
  it('covers every area with unique ids', () => {
    const ids = rows.map(row => row[0]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const prefix of ['MAC', 'NET', 'IPH', 'DSP', 'REC']) expect(ids.filter(id => id.startsWith(prefix)).length).toBeGreaterThan(5);
  });
  it('records no results, devices, dates or evidence: nothing is claimed as tested', () => {
    expect(rows.length).toBeGreaterThan(50);
    for (const row of rows) {
      expect(row, row[0]).toHaveLength(8);
      const [, test, expected, actual, result, device, date, notes] = row;
      expect(test && expected).toBeTruthy();
      expect(result, row[0]).toBe('NOT TESTED');
      expect([actual, device, date, notes], row[0]).toEqual(['', '', '', '']);
    }
  });
});
