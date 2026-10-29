import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

const results = { security: { result: 'success' }, checks: { result: 'success' }, browser: { result: 'success' } };
function run(value: string) {
  return spawnSync(process.execPath, ['scripts/verify-merge-gate.mjs'], {
    env: { ...process.env, GATE_NEEDS_JSON: value }, encoding: 'utf8'
  }).status;
}

describe('merge gate', () => {
  it('accepts all required successful jobs', () => expect(run(JSON.stringify(results))).toBe(0));
  it.each(['failure', 'cancelled', 'skipped'])('rejects %s', result => {
    expect(run(JSON.stringify({ ...results, browser: { result } }))).not.toBe(0);
  });
  it('rejects missing results', () => expect(run(JSON.stringify({ security: results.security }))).not.toBe(0));
  it('rejects malformed input', () => expect(run('{')).not.toBe(0));
});
