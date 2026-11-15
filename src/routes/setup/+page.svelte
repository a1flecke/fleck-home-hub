<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  let { data, form } = $props();
  let timezone = $state<HTMLInputElement>();
  onMount(() => {
    if (timezone && document.activeElement !== timezone && !form?.timezone && timezone.value === data.timezone) {
      timezone.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
  });
</script>

<svelte:head><title>Set up your family · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-xl px-5 py-8 sm:py-14">
  <a href={resolve('/')} class="text-sm font-semibold text-teal-800">Fleck Home Hub</a>
  <div class="mt-5 rounded-3xl bg-white p-6 shadow-sm sm:p-9">
    <p class="text-sm font-semibold text-teal-800">{form?.parentStep ? 'Step 2 of 2' : 'Step 1 of 2'}</p>
    {#if form?.parentStep}
      <h1 class="mt-2 text-3xl font-bold">Create your parent account</h1>
      <p class="mt-2">You’ll use this account to manage {form.household} and invite the people you live with.</p>
    {:else}
      <h1 class="mt-2 text-3xl font-bold">Create your household</h1>
      <p class="mt-2">Give your family’s space a name. Your time zone keeps chores, dinner, and calendar dates in sync.</p>
    {/if}
    {#if form?.message}<p role="alert" class="mt-4 rounded-xl bg-red-50 p-3 text-red-800">{form.message}</p>{/if}

    {#if form?.parentStep}
      <form aria-label="Create parent account" method="POST" action="?/parent" class="mt-6 grid gap-4">
        <input type="hidden" name="household" value={form.household} />
        <input type="hidden" name="timezone" value={form.timezone} />
        <label class="grid gap-1 font-medium">Your name<input name="name" autocomplete="name" required maxlength="100" defaultValue={form.name ?? ''} class="rounded-xl border border-gray-400 p-3" /></label>
        <label class="grid gap-1 font-medium">Email address<input type="email" name="email" autocomplete="username" required maxlength="254" defaultValue={form.email ?? ''} class="rounded-xl border border-gray-400 p-3" /></label>
        <label class="grid gap-1 font-medium">Password<input type="password" name="password" autocomplete="new-password" required minlength="12" maxlength="128" class="rounded-xl border border-gray-400 p-3" /></label>
        <label class="grid gap-1 font-medium">Confirm password<input type="password" name="confirmation" autocomplete="new-password" required minlength="12" maxlength="128" class="rounded-xl border border-gray-400 p-3" /></label>
        <label class="grid gap-1 font-medium">Setup code<input type="password" name="code" autocomplete="off" required maxlength="60" aria-describedby="code-help" class="rounded-xl border border-gray-400 p-3" /></label>
        <p id="code-help" class="text-sm text-gray-700">Use the one-time code from the person who set up this home hub.</p>
        <div class="flex flex-wrap items-center gap-3">
          <button class="rounded-xl bg-teal-800 px-5 py-3 font-semibold text-white">Create account</button>
          <button type="submit" name="back" value="yes" formnovalidate class="rounded-xl px-4 py-3 font-semibold text-teal-900">Back</button>
        </div>
      </form>
    {:else}
      <form aria-label="Create household" method="POST" action="?/household" class="mt-6 grid gap-4">
        <label class="grid gap-1 font-medium">Family name<input name="household" required maxlength="100" defaultValue={form?.household ?? ''} placeholder="For example, the Rivera family" class="rounded-xl border border-gray-400 p-3" /></label>
        <label class="grid gap-1 font-medium">Time zone<input name="timezone" list="time-zones" required bind:this={timezone} defaultValue={form?.timezone ?? data.timezone} class="rounded-xl border border-gray-400 p-3" /></label>
        <datalist id="time-zones">
          <option value="UTC"></option>
          {#each data.zones as zone (zone)}<option value={zone}></option>{/each}
        </datalist>
        <button class="justify-self-start rounded-xl bg-teal-800 px-5 py-3 font-semibold text-white">Continue</button>
      </form>
    {/if}
  </div>
</main>
