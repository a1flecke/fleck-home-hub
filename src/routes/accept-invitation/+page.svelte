<script lang="ts">
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';
  let { data, form }: { data: PageData; form: { token?: string; name?: string; email?: string; message?: string } | null } = $props();
  let token = $derived(form?.token ?? '');
  let name = $derived(form?.name ?? '');
  let email = $derived(form?.email ?? '');
  let password = $state('');
  let ready = $state(false);
  onMount(() => {
    if (location.hash) { token = location.hash.slice(1); void goto(resolve('/accept-invitation'), { replace: true, shallow: true }); }
    ready = true;
  });
</script>
<svelte:head><title>Join your household · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-md px-5 py-10">
  <h1 class="text-3xl font-bold">Join your household</h1>
  {#if data.success}<p class="mt-5">Your account is ready. You can sign in now.</p><a class="mt-4 inline-block rounded-xl bg-teal-700 px-5 py-3 text-white" href={resolve('/sign-in')}>Sign in</a>
  {:else}
    <p class="mt-4">Create your account with the invitation you received.</p>
    {#if form?.message}<p role="alert" class="mt-4 rounded-xl bg-red-50 p-4">{form.message}</p>{/if}
    <form method="POST" class="mt-6 grid gap-4">
      <input type="hidden" name="token" value={token} />
      <label class="grid gap-2">Name <input name="name" required bind:value={name} autocomplete="name" class="rounded-xl border p-3" /></label>
      <label class="grid gap-2">Email <input name="email" type="email" required bind:value={email} autocomplete="username" class="rounded-xl border p-3" /></label>
      <label class="grid gap-2">Password <input name="password" type="password" required minlength="12" bind:value={password} autocomplete="new-password" class="rounded-xl border p-3" /></label>
      <button disabled={!ready || !token} class="rounded-xl bg-teal-700 px-5 py-3 font-bold text-white">Create account</button>
      {#if ready && !token}<p>This invitation link is missing. Ask a parent for a new one.</p>{/if}
    </form>
  {/if}
</main>
