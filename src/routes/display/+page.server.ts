import type { PageServerLoad } from './$types';
import { displayCookieName, DISPLAY_COOKIE_PATH } from '../../lib/server/display-session';
import { resolveDisplayView } from '../../lib/server/display-view';
import { getIdentityServices } from '../../lib/server/runtime';

export const load: PageServerLoad = async ({ request, cookies }) => {
  const view = await resolveDisplayView(request);
  // A revoked or expired credential is dropped so the kiosk stops presenting it.
  if (view.mode === 'unpaired') cookies.delete(displayCookieName(getIdentityServices().origin), { path: DISPLAY_COOKIE_PATH });
  return view;
};
