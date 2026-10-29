<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  let ready = $state(false);
  onMount(() => { ready = true; });
  let email = $state('');
  let password = $state('');
  let error = $state('');
  let busy = $state(false);
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = '';
    try {
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (!response.ok) { error = 'Unable to sign in. Check your details or try again later.'; return; }
      window.location.assign('/dashboard');
    } catch { error = 'Unable to sign in. Please try again.'; }
    finally { busy = false; }
  }
</script>
<svelte:head><title>Sign in · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-md px-6 py-12">
  <a href={resolve('/')} class="text-teal-700">← Family display</a>
  <h1 class="mt-8 text-3xl font-bold">Sign in</h1>
  <form onsubmit={submit} class="mt-8 grid gap-5">
    <label class="grid gap-2">Email <input type="email" autocomplete="username" required bind:value={email} class="rounded-xl border border-gray-400 bg-white px-4 py-3" /></label>
    <label class="grid gap-2">Password <input type="password" autocomplete="current-password" required bind:value={password} class="rounded-xl border border-gray-400 bg-white px-4 py-3" /></label>
    {#if error}<p role="alert" class="text-red-800">{error}</p>{/if}
    <button type="submit" disabled={busy || !ready} class="rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white">{busy ? 'Signing in…' : 'Sign in'}</button>
  </form>
</main>
