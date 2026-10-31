import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function setting(name: string): string {
  return execFileSync('pnpm', ['config', 'get', name], { encoding: 'utf8' }).trim();
}

describe('pnpm supply-chain policy', () => {
  it('requires three days of verifiable release age, without fallback', () => {
    expect(setting('minimumReleaseAge')).toBe('4320');
    expect(setting('minimumReleaseAgeStrict')).toBe('true');
    expect(setting('minimumReleaseAgeIgnoreMissingTime')).toBe('false');
    expect(setting('trustLockfile')).toBe('false');
  });

  it('blocks exotic transitive sources and allows only reviewed build scripts', () => {
    expect(setting('blockExoticSubdeps')).toBe('true');
    expect(setting('strictDepBuilds')).toBe('true');
    expect(setting('dangerouslyAllowAllBuilds')).toBe('false');
    expect(JSON.parse(setting('allowBuilds'))).toEqual({ esbuild: true });
  });
});
