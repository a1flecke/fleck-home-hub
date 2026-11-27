import { error, redirect } from '@sveltejs/kit';
import { requestAccess } from '../../lib/server/request-access';

export async function templateParent(request: Request) {
  const access = await requestAccess(request);
  if (access.status === 'anonymous') redirect(303, '/sign-in');
  if (access.status === 'unavailable') error(503, 'Identity service unavailable');
  if (access.status === 'forbidden' || access.role !== 'parent') error(403, 'This page is for parents.');
  if (request.method === 'POST' && request.headers.get('origin') !== access.origin) error(403, 'Request not authorized.');
  return access;
}
