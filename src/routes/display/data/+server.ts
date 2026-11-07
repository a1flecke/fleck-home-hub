import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { displayCookieName, DISPLAY_COOKIE_PATH } from '../../../lib/server/display-session';
import { resolveDisplayView } from '../../../lib/server/display-view';
import { getIdentityServices } from '../../../lib/server/runtime';

export const GET: RequestHandler = async ({ request, cookies }) => {
  const view = await resolveDisplayView(request);
  if (view.mode === 'unpaired') {
    cookies.delete(displayCookieName(getIdentityServices().origin), { path: DISPLAY_COOKIE_PATH });
    return json({ mode: 'unpaired' }, { status: 401 });
  }
  return json(view);
};
