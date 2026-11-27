import type { PageServerLoad } from './$types';
import { listChecklistTemplates } from '../../../lib/server/checklists';
import { templateParent } from '../template-access.server';

export const load: PageServerLoad = async ({ request }) => {
  const { db, userId, householdId } = await templateParent(request);
  return { templates: listChecklistTemplates(db, userId, householdId) };
};
