import type Database from 'better-sqlite3';
import { Worker } from 'node:worker_threads';
import workerSource from './onboarding-worker.js?raw';
import { setupCodeHash, usableSetupCode } from './setup-code';

export type InitialParent = { name: string; email: string; password: string; household: string; timezone: string };
type Provisioning =
  | { kind: 'setup'; hash: string; input: InitialParent }
  | { kind: 'child'; actor: string; householdId: string; requestId: string | null; input: { name: string; username: string | null; password: string } };
type Result = { userId: string; cookies: string[] };
let activeProvisioning = 0;

export async function provisionFirstParent(db: Database.Database, config: { secret: string; origin: string }, code: string, input: InitialParent): Promise<string[]> {
  const { name, email, password, household, timezone } = input;
  if (!/^[A-Za-z0-9_-]{43}$/.test(code) || !name.trim() || name.length > 100 ||
      !household.trim() || household.length > 100 || email.length > 254 ||
      password.length < 12 || password.length > 128 || timezone.length > 100) throw new Error('Invalid setup details');
  new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  const hash = setupCodeHash(code);
  if (!usableSetupCode(db, hash)) throw new Error('Initial setup unavailable');

  const { cookies } = await runOnboardingProvisioning(db, config, { kind: 'setup', hash, input });
  return cookies;
}

export async function runOnboardingProvisioning(db: Database.Database, config: { secret: string; origin: string }, operation: Provisioning): Promise<Result> {
  if (activeProvisioning >= 2) throw new Error('Account provisioning is busy');
  activeProvisioning++;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(workerSource, {
        eval: true,
        env: { NODE_ENV: process.env.NODE_ENV },
        workerData: { path: db.name, config: { secret: config.secret, origin: config.origin }, operation },
        stdout: true,
        stderr: true
      });
      // Keep the worker's output out of process logs, including on failure.
      worker.stdout.resume();
      worker.stderr.resume();
      let result: Result | undefined;
      worker.on('message', (message) => {
        if (typeof message?.userId === 'string' && Array.isArray(message.cookies)) result = message;
      });
      worker.once('error', () => reject(new Error('Account provisioning failed')));
      worker.once('exit', (code) => {
        if (code === 0 && result) resolve(result);
        else reject(new Error('Account provisioning failed'));
      });
    });
  } finally {
    activeProvisioning--;
  }
}

export type OnboardingStep = 'parents' | 'children' | 'activities' | 'complete';
const stages: OnboardingStep[] = ['parents', 'children', 'activities', 'complete'];

export function onboardingStep(db: Database.Database, householdId: string) {
  return (db.prepare('SELECT step FROM household_onboarding WHERE household_id = ?').get(householdId) as { step: OnboardingStep } | undefined)?.step;
}

export function advanceOnboarding(db: Database.Database, actor: string, householdId: string, expected: string, move: 'next' | 'back' | 'finish') {
  return db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM active_membership WHERE user_id = ? AND household_id = ? AND role = 'parent'").get(actor, householdId)) throw new Error('Not authorized');
    const current = onboardingStep(db, householdId);
    if (!current || current === 'complete') return true;
    if (current !== expected) return false;
    const step = move === 'finish' ? 'complete' : stages[Math.max(0, stages.indexOf(current) + (move === 'back' ? -1 : 1))];
    db.prepare('UPDATE household_onboarding SET step = ? WHERE household_id = ?').run(step, householdId);
    return step === 'complete';
  }).immediate();
}
