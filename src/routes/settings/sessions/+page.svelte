<script lang="ts">
  import { resolve } from '$app/paths';
  import type { PageData } from './$types';
  let { data, form }: { data: PageData; form: { message?: string } | null } = $props();
  const when = (value: number) => new Date(value).toLocaleString();
</script>
<svelte:head><title>Signed-in devices · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-3xl px-5 py-8">
  <a href={resolve('/dashboard')} class="text-teal-700">Back to home</a>
  <h1 class="mt-5 text-3xl font-bold">Signed-in devices</h1>
  <p class="mt-2">These are the devices signed in to your account. Signing a device out affects your whole account, so it applies to every household you belong to. It does not change who is a member of a household; parents manage that under Household access.</p>
  {#if form?.message}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4">{form.message}</p>{/if}
  {#if data.reauthenticate}
    <section class="mt-6 rounded-2xl bg-white p-5 shadow-sm"><h2 class="text-xl font-bold">Sign in again to continue</h2><p class="mt-2">For your security, this page needs a recent sign-in. Sign out, then sign in again to manage your devices.</p>
      <form method="POST" action={resolve('/sign-out')} class="mt-3"><button class="rounded-xl border border-teal-700 px-4 py-3">Sign out</button></form></section>
  {:else}
  <section class="mt-6 rounded-2xl bg-white p-5 shadow-sm"><h2 class="text-xl font-bold">Your sessions</h2>
    <ul>{#each data.sessions as session (session.id)}<li class="mt-4"><p>{session.device}{session.current ? ' · This device' : ''}</p><p class="text-sm">Signed in {when(session.createdAt)} · expires {when(session.expiresAt)}</p>
      {#if !session.current}<details class="mt-2"><summary class="cursor-pointer rounded-xl border border-red-800 px-4 py-3">Sign out this device</summary><p class="mt-2">This device will need to sign in again.</p><form method="POST" action="?/revoke" class="mt-2"><input type="hidden" name="id" value={session.id} /><button class="rounded-xl bg-red-800 px-4 py-3 font-bold text-white">Confirm sign out of {session.device}</button></form></details>{/if}</li>{/each}</ul>
  </section>
  {#if data.sessions.length > 1}
  <section class="mt-6 rounded-2xl bg-white p-5 shadow-sm"><h2 class="text-xl font-bold">Lost a device or unsure?</h2>
    <details class="mt-2"><summary class="cursor-pointer rounded-xl border border-red-800 px-4 py-3">Sign out all other devices</summary><p class="mt-2">Every other device will be signed out of your account and all of its households. This device stays signed in.</p><form method="POST" action="?/revokeOthers" class="mt-2"><button class="rounded-xl bg-red-800 px-4 py-3 font-bold text-white">Confirm sign out of all other devices</button></form></details>
  </section>
  {/if}
  {/if}
</main>
