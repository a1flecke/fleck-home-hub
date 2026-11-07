import type { PageServerLoad } from './$types';
import { resolveDisplayView } from '../../lib/server/display-view';

// A revoked or expired display credential is deliberately left in place: it can never authorize
// anything again, and keeping it means a reload shows "Pairing required" instead of a sign-in page.
export const load: PageServerLoad = ({ request }) => resolveDisplayView(request);
