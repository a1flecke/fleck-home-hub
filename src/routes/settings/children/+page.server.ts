import { randomUUID } from 'node:crypto';
import type { Actions, PageServerLoad } from './$types';
import { parentHousehold } from '../../../lib/server/parent-household';
import { handleChildForm } from '../../../lib/server/child-forms';
import { listManagedChildren } from '../../../lib/server/managed-children';

export const load: PageServerLoad = async ({ request, setHeaders, url }) => {
  setHeaders({ 'cache-control': 'no-store' });
  const { db, actor, household } = await parentHousehold(request, url.searchParams.get('household'));
  return { household, children: listManagedChildren(db, actor, household.id), requestId: randomUUID() };
};

export const actions: Actions = {
  add: ({ request, url }) => handleChildForm(request, 'add', url.searchParams.get('household')),
  rename: ({ request, url }) => handleChildForm(request, 'rename', url.searchParams.get('household')),
  credentials: ({ request, url }) => handleChildForm(request, 'credentials', url.searchParams.get('household'))
};
