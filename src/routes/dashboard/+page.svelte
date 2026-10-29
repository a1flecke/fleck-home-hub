<script lang="ts">
  import { resolve } from '$app/paths';
  let { data } = $props();
  let message = $state('');
  async function testAction() {
    const response = await fetch(`/api/households/${encodeURIComponent(data.householdId)}/parent-test`, { method: 'POST' });
    message = response.ok ? 'Parent access confirmed.' : 'Unable to confirm access.';
  }
  async function signOut() {
    const response = await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (response.ok) window.location.assign('/');
    else message = 'Unable to sign out. Please try again.';
  }
</script>
<svelte:head><title>My day · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-4xl px-6 py-12">
  <a href={resolve('/')} class="text-teal-700">Family display</a>
  <h1 class="mt-8 text-3xl font-bold">Hello, {data.name}</h1>
  <p class="mt-2">{data.role === 'parent' ? 'Parent dashboard' : 'Your day'}</p>
  <section class="mt-8 rounded-2xl bg-white p-6 shadow-sm"><h2 class="text-xl font-semibold">Chores</h2><p class="mt-3">No chores to show yet.</p></section>
  {#if data.role === 'parent'}
    <section class="mt-5 rounded-2xl bg-white p-6 shadow-sm"><h2 class="text-xl font-semibold">Upcoming events</h2><p class="mt-3">No events to show yet.</p><button onclick={testAction} class="mt-4 rounded-xl bg-teal-700 px-4 py-3 text-white">Check parent access</button></section>
  {/if}
  {#if message}<p role="status" class="mt-4">{message}</p>{/if}
  <button onclick={signOut} class="mt-8 rounded-xl border border-teal-700 px-4 py-3 text-teal-700">Sign out</button>
</main>
