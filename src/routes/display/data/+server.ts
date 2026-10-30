import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadDisplay } from '../../../lib/server/display-view';

export const GET: RequestHandler = async ({ request }) => json(await loadDisplay(request));
