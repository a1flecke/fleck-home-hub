import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

const [binary, archive] = process.argv.slice(2);
assert(process.argv.length === 4 && isAbsolute(binary) && isAbsolute(archive),
  'Pass absolute paths to the OpenCode binary and verified v0.5.1 archive.');
const archiveBytes = readFileSync(archive);
assert.equal(createHash('sha256').update(archiveBytes).digest('hex'),
  '55043537fc91573d8e1f8e7f2c7fb8aa7607374629569106cd547384af05c22f',
  'Expected the pinned OpenCode approval plugin v0.5.1 release.');

const projectConfig = JSON.parse(readFileSync(
  new URL('../.opencode/opencode.jsonc', import.meta.url), 'utf8'
).replace(/^\s*\/\/.*$/gm, ''));
const mergeDeny = projectConfig.policies.find(rule => rule.action === 'tool.use' &&
  rule.resource === 'shell:gh pr merge *' && rule.effect === 'deny');
assert(mergeDeny, 'The worktree must declare a native PR merge deny.');
const buildMergeRule = projectConfig.agents.build.permissions.find(rule =>
  rule.action === 'shell' && rule.resource === 'gh pr merge *');
assert.equal(buildMergeRule?.effect, 'deny', 'The worktree must also deny PR merges for the build agent.');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'fleck-opencode-')));
const merge = 'gh pr merge 1';
const trustedScript = 'scripts/probe.sh';
const gitEnv = {
  PATH: '/usr/bin:/bin',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid'
};

// The adapter delegates decisions to the released plugin. It supplies only a
// synthetic reviewer transport and copies sanitized decision codes for assertions.
const adapter = `
import { appendFileSync } from 'node:fs';
import plugin from '../release/index.ts';
const record = (value) => appendFileSync(process.env.FLECK_PROBE_EVENTS, JSON.stringify(value) + '\\n');
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (url !== 'https://opencode.ai/zen/v1/systemone') return originalFetch(url, init);
  const { state, questions } = JSON.parse(init.body);
  record({ reviewer: true });
  if (state.includes('fleck-http-error')) return new Response('', { status: 503 });
  if (state.includes('fleck-malformed')) return Response.json({});
  if (state.includes('fleck-timeout')) return new Promise(() => {});
  return Response.json({ answers: Object.fromEntries(Object.keys(questions)
    .map(key => [key, { type: 'noul', noul: 1 }])) });
};
export default {
  id: plugin.id,
  async setup(ctx) {
    await plugin.setup({ ...ctx, storage: {
      get: key => ctx.storage.get(key),
      async set(key, value) {
        if (key === 'model-approval:recent-decisions') record({ reason: value.at(-1).reasonCode });
        return ctx.storage.set(key, value);
      }
    } });
    record({ ready: true });
  }
};
`;

function fixture(directory, withKey) {
  mkdirSync(directory);
  const repo = join(directory, 'repo');
  const clean = join(directory, 'clean');
  const dirty = join(directory, 'dirty');
  const git = (...args) => execFileSync('git', args, { cwd: directory, env: gitEnv, stdio: 'pipe' });
  git('init', '-q', '-b', 'main', repo);
  git('-C', repo, 'remote', 'add', 'origin', 'https://github.com/example/synthetic.git');
  mkdirSync(join(repo, 'scripts'));
  writeFileSync(join(repo, trustedScript), '#!/bin/sh\nexit 0\n');
  git('-C', repo, 'add', trustedScript);
  git('-C', repo, 'commit', '-qm', 'synthetic fixture');
  git('-C', repo, 'worktree', 'add', '-qb', 'fixture/clean', clean);
  git('-C', repo, 'worktree', 'add', '-qb', 'fixture/dirty', dirty);
  writeFileSync(join(dirty, trustedScript), '#!/bin/sh\nexit 1\n');

  const config = join(directory, 'config');
  const plugin = join(directory, 'probe-plugin');
  const events = join(directory, 'events.jsonl');
  mkdirSync(join(config, 'opencode'), { recursive: true });
  mkdirSync(plugin);
  writeFileSync(join(plugin, 'index.ts'), adapter);
  writeFileSync(join(plugin, 'package.json'), JSON.stringify({ type: 'module', main: 'index.ts' }));
  writeFileSync(events, '', { mode: 0o600 });
  writeFileSync(join(config, 'opencode', 'opencode.jsonc'), JSON.stringify({
    share: 'disabled',
    plugins: [{
      package: plugin,
      options: {
        trustedRoots: [directory], trustedScripts: [trustedScript],
        apiKeyEnvVar: 'FLECK_PROBE_KEY', timeoutMs: 1000
      }
    }]
  }));
  writeFileSync(join(repo, 'opencode.jsonc'), JSON.stringify({
    policies: withKey ? [mergeDeny] : []
  }));
  return { repo, clean, dirty, events, env: {
    ...gitEnv,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: join(directory, 'data'),
    XDG_STATE_HOME: join(directory, 'state'),
    XDG_CACHE_HOME: join(directory, 'cache'),
    FLECK_PROBE_EVENTS: events,
    ...(withKey ? { FLECK_PROBE_KEY: 'synthetic-key' } : {})
  } };
}

function start(fixture) {
  const child = spawn(binary, ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd: fixture.repo, env: fixture.env, stdio: ['ignore', 'pipe', 'pipe']
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  let address;
  let password;
  const ready = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => reject(new Error(`OpenCode exited before readiness (${code}).`)));
    createInterface({ input: child.stdout }).on('line', line => {
      address ??= /^server listening on (http:\/\/127\.0\.0\.1:\d+)$/.exec(line)?.[1];
      password ??= /^server password (\S+)$/.exec(line)?.[1];
      if (address && password) resolve();
    });
    child.stderr.resume();
  });
  async function api(path, body, expectedStatus = 200) {
    const response = await fetch(address + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from('opencode:' + password).toString('base64'),
        'Content-Type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(5000)
    });
    assert.equal(response.status, expectedStatus, 'Unexpected OpenCode API status.');
    if (response.status !== 200) return;
    const result = await response.json();
    return path.startsWith('/api/config?') ? result : result.data;
  }
  return {
    async ready() {
      let timer;
      try {
        await Promise.race([ready, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Timed out starting the isolated OpenCode process.')), 10000);
        })]);
      } finally { clearTimeout(timer); }
    },
    async stop() {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      try { await closed; } finally { clearTimeout(timer); }
    },
    api,
    events: () => readFileSync(fixture.events, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  };
}

async function session(server, directory, mergeEffect) {
  const session = await server.api('/api/session', {
    location: { directory }, permissions: [
      { action: 'shell', resource: '*', effect: 'ask' },
      { action: 'shell', resource: merge, effect: mergeEffect }
    ]
  });
  assert.equal(session.location.directory, directory, 'OpenCode resolved the wrong location.');
  const location = new URLSearchParams({ 'location[directory]': directory });
  const deadline = Date.now() + 5000;
  while (!server.events().some(event => event.ready)) {
    await server.api('/api/plugin?' + location);
    assert(Date.now() < deadline, 'The approval plugin did not register its permission hook.');
    await delay(50);
  }
  return '/api/session/' + encodeURIComponent(session.id) + '/permission';
}

async function decision(server, path, resource, effect, events, cwd) {
  const before = server.events().length;
  const result = await server.api(path, { action: 'shell', resources: [resource], metadata: cwd ? { cwd } : {} });
  assert.equal(result.effect, effect, `Unexpected permission effect for ${resource}.`);
  assert.deepEqual(server.events().slice(before), events, `Unexpected plugin decisions for ${resource}.`);
  assert.equal(typeof result.id, 'string', 'Expected a permission request identifier.');
  return result.id;
}

async function rejectPending(server, path, id) {
  const pending = path + '/' + encodeURIComponent(id);
  assert.equal((await server.api(pending)).id, id, 'Expected an actual pending human approval.');
  await server.api(pending + '/reply', { decision: 'reject' }, 204);
  await server.api(pending, undefined, 404);
}

const active = [];
let cleanupPromise;
function cleanup() {
  return cleanupPromise ??= Promise.all(active.map(({ server }) => server.stop())).then(() => {
    rmSync(root, { recursive: true });
  });
}
for (const [signal, status] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    void cleanup().then(() => process.exit(status), () => process.exit(1));
  });
}
try {
  const verifiedArchive = join(root, 'verified.tgz');
  writeFileSync(verifiedArchive, archiveBytes, { mode: 0o600 });
  for (const name of ['primary', 'secondary']) {
    const directory = join(root, name);
    const data = fixture(directory, name === 'primary');
    const release = join(directory, 'release');
    mkdirSync(release);
    execFileSync('tar', ['-xzf', verifiedArchive, '--strip-components', '1', '-C', release],
      { cwd: directory, env: gitEnv, stdio: 'pipe' });
    const version = execFileSync(binary, ['--version'], { cwd: data.repo, env: data.env, encoding: 'utf8' });
    assert.equal(version.trim(), 'opencode v2.2.6', 'Recheck the API and plugin compatibility before changing the pinned CLI version.');
    const server = start(data);
    active.push({ data, server });
    await server.ready();
  }
  const [{ data, server }, { data: neighbor, server: other }] = active;
  const location = new URLSearchParams({ 'location[directory]': data.repo });
  const loaded = await server.api('/api/config?' + location);
  assert(JSON.stringify(loaded).includes(JSON.stringify(mergeDeny)), 'Native merge deny was not loaded for the fixture.');
  const path = await session(server, data.repo, 'allow');
  const defaultPath = await session(server, data.repo, buildMergeRule.effect);
  const otherPath = await session(other, neighbor.repo, 'allow');
  // With the hard policy absent, the same ordinarily allowed request reaches
  // the reviewer and requires approval because the second process has no key.
  const pending = await decision(other, otherPath, merge, 'ask', [{ reason: 'reviewer-key-missing' }]);
  await decision(server, defaultPath, merge, 'deny', []);
  // V2.2.6 can consult the reviewer when the ordinary rule is permissive.
  // The native policy still denies the request even after the reviewer allows it.
  const denied = await decision(server, path, merge, 'deny',
    [{ reviewer: true }, { reason: 'reviewer-all-checks-passed' }]);
  await server.api(path + '/' + encodeURIComponent(denied), undefined, 404);
  await decision(server, path, './' + trustedScript, 'allow', [{ reason: 'trusted-script-allowed' }], data.clean);
  const dirty = await decision(server, path, './' + trustedScript, 'ask', [{ reason: 'trusted-script-directory-dirty' }], data.dirty);
  await server.api(defaultPath + '/' + encodeURIComponent(dirty), undefined, 404);
  await other.api(otherPath + '/' + encodeURIComponent(dirty), undefined, 404);
  await server.api(path + '/' + encodeURIComponent(pending), undefined, 404);
  await rejectPending(server, path, dirty);
  await decision(server, path, 'printf fleck-positive', 'allow',
    [{ reviewer: true }, { reason: 'reviewer-all-checks-passed' }]);
  for (const [label, reason] of [
    ['http-error', 'reviewer-http-503'], ['malformed', 'reviewer-malformed-output'], ['timeout', 'reviewer-timeout']
  ]) {
    const id = await decision(server, path, 'printf fleck-' + label, 'ask', [{ reviewer: true }, { reason }]);
    await rejectPending(server, path, id);
  }
  await server.stop();
  rmSync(join(root, 'primary'), { recursive: true });
  await rejectPending(other, otherPath, pending);
  console.log('OpenCode hard deny, linked worktrees, reviewer fallbacks and concurrent cleanup passed.');
} finally {
  await cleanup();
}
