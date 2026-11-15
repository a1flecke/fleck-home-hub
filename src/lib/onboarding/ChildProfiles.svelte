<script lang="ts">
  import Disclosure from '../../routes/calendar/Disclosure.svelte';
  type Child = { id: string; name: string; username: string | null };
  type Result = { childMessage?: string; childError?: string; childAction?: string; childId?: string; name?: string; username?: string; requestId?: string };
  let { children, form, requestId, addAction, renameAction, credentialsAction }: {
    children: Child[]; form?: Result | null; requestId: string; addAction: string; renameAction: string; credentialsAction: string;
  } = $props();
  let addDraft = $derived(form?.childAction === 'add' ? form : null);
</script>

<div class="grid gap-5">
  {#if form?.childError}<p role="alert" class="rounded-xl bg-red-50 p-3 text-red-800">{form.childError}</p>{/if}
  {#if form?.childMessage}<p role="status" class="rounded-xl bg-teal-50 p-3 text-teal-900">{form.childMessage}</p>{/if}
  {#each children as child (child.id)}
    <article aria-label={child.name} class="rounded-2xl border border-teal-100 p-4">
      <h2 class="text-lg font-bold">{child.name}</h2>
      <p class="mt-1 text-sm text-gray-700">{child.username ? 'Username: ' + child.username : 'Sign-in not set up yet'}</p>
      {#if child.username}<p class="mt-1 text-sm text-gray-700">Share their username and password privately. They’ll choose Child sign-in.</p>{/if}
      <Disclosure class="mt-3" expanded={form?.childId === child.id && Boolean(form?.childError)}>
        <summary class="cursor-pointer font-semibold text-teal-800">Edit profile or sign-in</summary>
        <form aria-label={'Rename ' + child.name} method="POST" action={renameAction} class="mt-4 grid gap-2">
          <input type="hidden" name="child" value={child.id} />
          <label class="grid gap-1 text-sm font-medium">Name<input name="name" required maxlength="100" defaultValue={form?.childAction === 'rename' && form?.childId === child.id ? form.name : child.name} class="rounded-lg border border-gray-400 p-2" /></label>
          <button class="justify-self-start rounded-lg border border-teal-700 px-3 py-2 font-semibold text-teal-900">Save name</button>
        </form>
        <form aria-label={'Sign-in for ' + child.name} method="POST" action={credentialsAction} class="mt-4 grid gap-2 border-t border-teal-100 pt-4">
          <input type="hidden" name="child" value={child.id} />
          <label class="grid gap-1 text-sm font-medium">Username<input name="username" autocomplete="off" autocapitalize="none" required maxlength="32" defaultValue={(form?.childAction === 'credentials' && form?.childId === child.id ? form.username : child.username) ?? ''} class="rounded-lg border border-gray-400 p-2" /></label>
          <label class="grid gap-1 text-sm font-medium">New password<input name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="128" class="rounded-lg border border-gray-400 p-2" /></label>
          <label class="grid gap-1 text-sm font-medium">Confirm new password<input name="confirmation" type="password" autocomplete="new-password" required minlength="12" maxlength="128" class="rounded-lg border border-gray-400 p-2" /></label>
          {#if child.username}<p class="text-sm text-gray-700">Saving a new password signs this child out on all devices.</p>{/if}
          <button class="justify-self-start rounded-lg border border-teal-700 px-3 py-2 font-semibold text-teal-900">Save sign-in</button>
        </form>
      </Disclosure>
    </article>
  {/each}
  <form aria-label="Add a child" method="POST" action={addAction} class="grid gap-3 rounded-2xl bg-teal-50 p-4">
    <input type="hidden" name="requestId" value={form?.requestId ?? requestId} />
    <label class="grid gap-1 font-medium">Child’s name<input name="name" required maxlength="100" defaultValue={addDraft?.name ?? ''} class="rounded-xl border border-gray-400 bg-white p-3" /></label>
    <Disclosure expanded={Boolean(addDraft?.username)} class="grid gap-3">
      <summary class="cursor-pointer font-semibold text-teal-900">Set up sign-in now</summary>
      <p class="mt-2 text-sm">Choose a username and password to share with your child. You can leave both blank and set them later.</p>
      <label class="mt-3 grid gap-1 font-medium">Username<input name="username" autocomplete="off" maxlength="32" autocapitalize="none" defaultValue={addDraft?.username ?? ''} class="rounded-xl border border-gray-400 bg-white p-3" /></label>
      <label class="mt-3 grid gap-1 font-medium">Password<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" class="rounded-xl border border-gray-400 bg-white p-3" /></label>
      <label class="mt-3 grid gap-1 font-medium">Confirm password<input name="confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="128" class="rounded-xl border border-gray-400 bg-white p-3" /></label>
    </Disclosure>
    <button class="justify-self-start rounded-xl bg-teal-800 px-5 py-3 font-semibold text-white">Add child</button>
  </form>
</div>
