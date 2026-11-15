import type { PageServerLoad } from './$types';
import { getIdentityServices } from '../lib/server/runtime';
import { needsInitialSetup } from '../lib/server/setup-code';

export const load: PageServerLoad = () => {
  try {
    return { firstRun: needsInitialSetup(getIdentityServices().db) };
  } catch {
    // The existing landing page is also available to developer previews that
    // have no configured database.
    return { firstRun: false };
  }
};
