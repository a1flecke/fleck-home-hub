import { error, fail, redirect } from '@sveltejs/kit';
import type Database from 'better-sqlite3';
import type { Actions, PageServerLoad } from './$types';
import {
  addBulkGroceries,
  BulkConflictError,
  BulkValidationError,
  listGroceries
} from '../../../lib/server/groceries';
import { getIdentityServices } from '../../../lib/server/runtime';
import {
  buildBulkReview,
  bulkActions,
  MAX_BULK_LINES,
  readBulkInput,
  type BulkAction,
  type BulkDecision,
  type BulkInputError,
  type BulkOverrides
} from '../../../lib/grocery/bulk';

const MAX_BULK_BODY_BYTES = 64 * 1024;

/** Reads a bulk submission while refusing to buffer an unbounded body. */
async function boundedBulkForm(request: Request): Promise<FormData | null> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_BULK_BODY_BYTES) return null;
  if (!request.body) return request.formData();
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BULK_BODY_BYTES) { await reader.cancel(); return null; }
      chunks.push(new Uint8Array(value));
    }
  } catch { return null; }
  const contentType = request.headers.get('content-type') ?? '';
  try {
    return await new Request(request.url, { method: 'POST', headers: { 'content-type': contentType }, body: new Blob(chunks, { type: contentType }) }).formData();
  } catch { return null; }
}

async function principal(request: Request) {
  let services;
  try { services = getIdentityServices(); } catch { error(503, 'Identity service unavailable'); }
  const session = await services.auth.api.getSession({ headers: request.headers });
  if (!session) redirect(303, '/sign-in');
  const member = services.db.prepare('SELECT household_id AS householdId, role FROM active_membership WHERE user_id = ? ORDER BY household_id LIMIT 1').get(session.user.id) as { householdId: string; role: string } | undefined;
  if (!member) error(403, 'No household access');
  return { ...services, actor: session.user.id, householdId: member.householdId, role: member.role };
}

function inputMessage(error: BulkInputError): string {
  if (error === 'too_many') return `Paste at most ${MAX_BULK_LINES} items at a time.`;
  if (error === 'too_large') return 'The pasted list is too large. Paste fewer or shorter lines.';
  return 'Paste at least one grocery item.';
}

function activeGroceries(db: Database.Database, actor: string, householdId: string) {
  return listGroceries(db, actor, householdId).filter(item => !item.completed);
}

function reviewFrom(db: Database.Database, actor: string, householdId: string, lines: string[], overrides: BulkOverrides = {}) {
  return buildBulkReview(lines, activeGroceries(db, actor, householdId), overrides);
}

function overrides(decisions: BulkDecision[]): BulkOverrides {
  return Object.fromEntries(decisions.map(decision => [decision.key, {
    action: decision.action,
    name: decision.name,
    quantity: decision.quantity,
    unit: decision.unit
  }]));
}

function bulkDecisions(form: FormData): BulkDecision[] | null {
  const rowCount = Number(form.get('rowCount'));
  if (!Number.isInteger(rowCount) || rowCount < 1 || rowCount > MAX_BULK_LINES) return null;
  const decisions: BulkDecision[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const action = String(form.get(`action-${index}`) ?? '');
    if (!bulkActions.includes(action as BulkAction)) return null;
    decisions.push({
      key: String(form.get(`key-${index}`) ?? ''),
      line: String(form.get(`line-${index}`) ?? ''),
      action: action as BulkAction,
      name: String(form.get(`name-${index}`) ?? ''),
      quantity: String(form.get(`quantity-${index}`) ?? ''),
      unit: String(form.get(`unit-${index}`) ?? '')
    });
  }
  return decisions;
}

export const load: PageServerLoad = async ({ request }) => {
  await principal(request);
  return {};
};

export const actions = {
  review: async ({ request }) => {
    const { db, actor, householdId, origin } = await principal(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });

    const form = await boundedBulkForm(request);
    if (!form) return fail(413, { message: 'The pasted list was too large. Paste fewer or shorter lines.' });
    const list = String(form.get('list') ?? '');
    const input = readBulkInput(list);
    if (input.error) return fail(400, { message: inputMessage(input.error), list });

    try { return { review: reviewFrom(db, actor, householdId, input.lines), list }; }
    catch (err) {
      if (err instanceof Error && err.message === 'Not authorized') return fail(403, { message: 'Request not authorized.' });
      throw err;
    }
  },
  confirm: async ({ request }) => {
    const { db, actor, householdId, origin } = await principal(request);
    if (request.headers.get('origin') !== origin) return fail(403, { message: 'Request not authorized.' });

    const form = await boundedBulkForm(request);
    if (!form) return fail(413, { message: 'The submitted list was too large. Review fewer or shorter items.' });
    const decisions = bulkDecisions(form);
    if (!decisions) return fail(400, { message: 'The submitted list was not valid. Review the items and try again.' });

    try {
      const result = addBulkGroceries(db, actor, householdId, decisions);
      redirect(303, `/groceries?added=${result.added}&skipped=${result.skipped}`);
    } catch (err) {
      if (err instanceof BulkConflictError) {
        try {
          return fail(409, {
            message: 'The grocery list changed. An item now matches the list or another selected row. Nothing was added. Check the highlighted items, then confirm again or skip them.',
            review: reviewFrom(db, actor, householdId, decisions.map(decision => decision.line), overrides(decisions))
          });
        } catch { return fail(409, { message: 'The grocery list changed. Nothing was added. Refresh the list and review again.' }); }
      }
      if (err instanceof BulkValidationError) {
        try {
          return fail(400, {
            message: 'Check each item name, quantity and unit, then confirm again.',
            review: reviewFrom(db, actor, householdId, decisions.map(decision => decision.line), overrides(decisions))
          });
        } catch { return fail(400, { message: 'Check each item name, quantity and unit.' }); }
      }
      if (err instanceof Error && err.message === 'Not authorized') return fail(403, { message: 'Request not authorized.' });
      throw err;
    }
  }
} satisfies Actions;
