import { expect, it } from 'vitest';
import { checkVersions } from '../scripts/check-tool-versions.mjs';

it('accepts matching exact pnpm versions', () => expect(checkVersions('pnpm@12.16.1', '12.16.1')).toBe(true));
it.each([['pnpm@12.16.0', '12.16.1'], ['pnpm@^12.16.1', '12.16.1'], ['yarn@12.16.1', '12.16.1'], ['', '12.16.1']])('rejects mismatch or ranges', (pkg, tool) => expect(checkVersions(pkg, tool)).toBe(false));
