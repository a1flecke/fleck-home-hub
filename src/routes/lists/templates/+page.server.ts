import type { PageServerLoad } from './$types';
import { listChecklistTemplates } from '../../../lib/server/checklists';
import { checklistParent } from '../parent-access.server';

export const load: PageServerLoad = async ({ request }) => {
  const { db, userId, householdId } = await checklistParent(request);
  return { templates: listChecklistTemplates(db, userId, householdId) };
};
