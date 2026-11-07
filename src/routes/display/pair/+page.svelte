<script lang="ts">
  import { resolve } from '$app/paths';
  let { data, form } = $props();
  let signedIn = $derived(data.signedIn || form?.signedIn === true);
</script>
<svelte:head><title>Pair a display · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-lg px-6 py-12">
  <h1 class="text-3xl font-bold">Pair this display</h1>
  {#if signedIn}
    <p class="mt-4">This device is signed in to a household account. A display must not hold a personal sign-in, so sign out first, then return to this page.</p>
    <form method="POST" action={resolve('/sign-out')} class="mt-6"><button class="rounded-xl border border-teal-700 px-4 py-3">Sign out of this account</button></form>
  {:else}
    <p class="mt-4">A parent creates a one-time pairing code under <strong>Household displays</strong> in settings. The code expires after 10 minutes and works once.</p>
    {#if form?.message}<p role="alert" class="mt-4 rounded-xl bg-amber-50 p-4">{form.message}</p>{/if}
    <form method="POST" class="mt-6 grid gap-4" autocomplete="off">
      <label class="grid gap-2 font-semibold">Pairing code
        <input name="code" required maxlength="64" autocomplete="off" autocapitalize="characters" spellcheck="false" class="rounded-xl border border-slate-400 px-4 py-3 font-mono text-lg uppercase" />
      </label>
      <button class="rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white">Pair this display</button>
    </form>
  {/if}
</main>
