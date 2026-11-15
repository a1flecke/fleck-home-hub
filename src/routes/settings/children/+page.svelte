<script lang="ts">
  import { resolve } from '$app/paths';
  import ChildProfiles from '../../../lib/onboarding/ChildProfiles.svelte';
  let { data, form } = $props();
  let query = $derived('household=' + encodeURIComponent(data.household.id));
</script>

<svelte:head><title>Child profiles · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-xl px-5 py-8">
  <a href={resolve(`/settings/household?${query}`)} class="font-semibold text-teal-800">Back to household access</a>
  <div class="mt-5 rounded-3xl bg-white p-6 shadow-sm sm:p-8">
    <h1 class="text-3xl font-bold">Child profiles</h1>
    <p class="mt-2">Add a child to {data.household.name} so they can have their own chores and dashboard. No email address needed.</p>
    <div class="mt-6"><ChildProfiles children={data.children} requestId={data.requestId} {form} addAction={`?/add&${query}`} renameAction={`?/rename&${query}`} credentialsAction={`?/credentials&${query}`} /></div>
  </div>
</main>
