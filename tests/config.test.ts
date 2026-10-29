import { expect, it } from 'vitest';
import { readIdentityConfig } from '../src/lib/server/config';

const valid = { AUTH_SECRET: 'x'.repeat(40), AUTH_ORIGIN: 'https://home.example.test', DATABASE_PATH: '/tmp/home.sqlite' };
it('requires explicit secret, origin, and database path', () => {
  expect(() => readIdentityConfig({})).toThrow();
  expect(() => readIdentityConfig({ ...valid, AUTH_SECRET: 'short' })).toThrow();
  expect(() => readIdentityConfig({ ...valid, DATABASE_PATH: '' })).toThrow();
});
it('requires HTTPS except for localhost development', () => {
  expect(() => readIdentityConfig({ ...valid, AUTH_ORIGIN: 'http://remote.example.test' })).toThrow();
  expect(() => readIdentityConfig({ ...valid, AUTH_ORIGIN: 'https://user:password@home.example.test' })).toThrow();
  expect(readIdentityConfig({ ...valid, AUTH_ORIGIN: 'http://127.0.0.1:3000' }).origin).toBe('http://127.0.0.1:3000');
});
