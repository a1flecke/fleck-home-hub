import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveDisplayView } from '../../../lib/server/display-view';

export const GET: RequestHandler = async ({ request }) => {
  const view = await resolveDisplayView(request);
  return view.mode === 'unpaired' ? json({ mode: 'unpaired' }, { status: 401 }) : json(view);
};
