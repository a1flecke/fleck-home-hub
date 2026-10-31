import type { PageServerLoad } from './$types';
import { loadDisplay } from '../../lib/server/display-view';

export const load: PageServerLoad = ({ request }) => loadDisplay(request);
