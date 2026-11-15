import { randomUUID } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import { addManagedChild, renameManagedChild, setChildSignIn } from './managed-children';
import { readIdentityConfig } from './config';
import { parentHousehold } from './parent-household';

type ChildAction = 'add' | 'rename' | 'credentials';

export async function handleChildForm(request: Request, action: ChildAction, selected: string | null = null) {
  const { db, actor, household, origin } = await parentHousehold(request, selected);
  if (request.headers.get('origin') !== origin) return fail(403, { childError: 'Open this form from your home hub.' });
  const form = await request.formData();
  const id = String(form.get('child') ?? '');
  const name = String(form.get('name') ?? '').trim().slice(0, 101);
  const username = String(form.get('username') ?? '').trim().slice(0, 33);
  const password = String(form.get('password') ?? '');
  const draft = { childAction: action, childId: id, name, username };
  if (action !== 'rename' && password !== String(form.get('confirmation') ?? '')) {
    return fail(400, { ...draft, childError: 'The passwords didn’t match. Enter them again.' });
  }
  try {
    if (action === 'add') {
      const key = String(form.get('requestId') ?? '');
      if (!key) return fail(400, { ...draft, childError: 'Open this form again and retry.' });
      await addManagedChild(db, readIdentityConfig(process.env), actor, household.id, { name, username, password }, key);
      return { childMessage: 'Child added.', requestId: randomUUID() };
    }
    if (action === 'rename') {
      renameManagedChild(db, actor, household.id, id, name);
      return { childMessage: 'Name saved.' };
    }
    await setChildSignIn(db, actor, household.id, id, username, password);
    return { childMessage: 'Sign-in saved. This child can use their new password.' };
  } catch {
    return fail(400, {
      ...draft,
      childError: action === 'rename'
        ? 'The name couldn’t be saved. Enter a name of up to 100 characters and try again.'
        : 'Check the details. Use a unique username and a password of 12 to 128 characters, or leave both blank when adding a child.'
    });
  }
}
