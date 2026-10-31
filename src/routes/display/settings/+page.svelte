<script lang="ts">
  import { resolve } from '$app/paths';
  let { data, form } = $props();
</script>
<svelte:head><title>Display settings · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-4xl px-5 py-8">
  <a href={resolve('/display')} class="text-teal-700">View family display</a>
  <section aria-label="Choose what to share" class="mt-8"><h1 class="text-2xl font-bold">Choose what to share</h1><p class="mt-2">Only selected titles, dates, times and chore status appear on the display. Shared event choices apply to the whole series.</p>
    {#if form?.message}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4">{form.message}</p>{/if}
    {#if data.choices}
      {#each data.choices.events as item (item.id)}<article class="mt-3 rounded-xl bg-white p-4"><h2 class="font-semibold">{item.title}</h2><form method="POST" action="?/share"><input type="hidden" name="kind" value="event" /><input type="hidden" name="id" value={item.id} /><input type="hidden" name="visible" value={item.shared ? 'no' : 'yes'} /><button class="mt-2 rounded-xl border border-teal-700 px-4 py-3">{item.shared ? 'Remove from display' : 'Show on display'}</button></form></article>{/each}
      {#each data.choices.chores as item (item.id)}<article class="mt-3 rounded-xl bg-white p-4"><h2 class="font-semibold">{item.title}</h2><form method="POST" action="?/share"><input type="hidden" name="kind" value="chore" /><input type="hidden" name="id" value={item.id} /><input type="hidden" name="visible" value={item.shared ? 'no' : 'yes'} /><button class="mt-2 rounded-xl border border-teal-700 px-4 py-3">{item.shared ? 'Remove from display' : 'Show on display'}</button></form></article>{/each}
    {/if}
  </section>
</main>
