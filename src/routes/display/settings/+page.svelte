<script lang="ts">
  import { resolve } from '$app/paths';
  let { data, form } = $props();
  let selected = $derived(`household=${encodeURIComponent(data.householdId)}`);
  // A named action replaces the whole query string, so carry the household and the shared-list page.
  let shareAction = $derived(`?/share&${selected}&sharedPage=${data.choices.shared.page}`);
</script>
{#snippet choice(kind: 'event' | 'chore', item: { id: string; title: string; shared: number }, detail: string)}
  <article class="mt-3 rounded-xl bg-white p-4"><h3 class="font-semibold">{item.title}</h3><p class="mt-1 text-sm">{detail}</p><form method="POST" action={shareAction}><input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={item.id} /><input type="hidden" name="visible" value={item.shared ? 'no' : 'yes'} /><button class="mt-2 rounded-xl border border-teal-700 px-4 py-3">{item.shared ? 'Remove from display' : 'Show on display'}</button></form></article>
{/snippet}
<svelte:head><title>Display settings · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-4xl px-5 py-8">
  <a href={resolve('/display')} class="text-teal-700">View family display</a> · <a href={resolve(`/settings/displays?${selected}`)} class="text-teal-700">Household displays</a>
  {#if data.households.length > 1}
    <form method="GET" class="mt-5"><label>Household <select name="household" class="rounded-xl border p-3">{#each data.households as household (household.id)}<option value={household.id} selected={household.id === data.householdId}>{household.name}</option>{/each}</select></label><button class="ml-2 rounded-xl border px-4 py-3">Show household</button></form>
  {/if}
  {#if form?.message}<p role="status" class="mt-6 rounded-xl bg-teal-50 p-4">{form.message}</p>{/if}
  <section aria-label="Choose what to share" class="mt-8"><h1 class="text-2xl font-bold">Choose what to share</h1><p class="mt-2">Only selected titles, dates, times and chore status appear on the display. Shared event choices apply to the whole series. These are the events and chores the display can show from <time datetime={data.today}>{data.today}</time> through <time datetime={data.end}>{data.end}</time>; a chore appears on its due date.</p>
    <h2 class="mt-6 text-xl font-bold">Events</h2>
    {#each data.choices.window.events as item (item.id)}{@render choice('event', item, item.repeats ? `Repeating series from ${item.date}` : item.date)}{:else}<p class="mt-3">No events in this window.</p>{/each}
    <h2 class="mt-6 text-xl font-bold">Chores</h2>
    {#each data.choices.window.chores as item (item.id)}{@render choice('chore', item, `Due ${item.date}`)}{:else}<p class="mt-3">No chores due in this window.</p>{/each}
  </section>
  <section aria-label="Shared outside this window" class="mt-10"><h2 class="text-xl font-bold">Shared outside this window</h2><p class="mt-2">Earlier, later, cancelled or skipped records that are still selected. Newest first; remove any you no longer need.</p>
    {#if data.choices.shared.total}
      <p class="mt-3 text-sm">Showing {data.choices.shared.items.length} of {data.choices.shared.total}.</p>
      {#each data.choices.shared.items as item (`${item.kind}:${item.id}`)}{@render choice(item.kind, { ...item, shared: 1 }, `${item.kind === 'event' ? (item.repeats ? `Repeating series from ${item.date}` : item.date) : `Chore due ${item.date}`}${item.cancelled ? ' · Cancelled' : ''}`)}{/each}
      {#if data.choices.shared.pageCount > 1}
        <nav aria-label="Shared selection pages" class="mt-4 flex flex-wrap items-center gap-4">
          {#if data.choices.shared.page > 1}<a href={resolve(`/display/settings?${selected}&sharedPage=${data.choices.shared.page - 1}`)} class="text-teal-800 underline">Previous page</a>{/if}
          <span>Page {data.choices.shared.page} of {data.choices.shared.pageCount}</span>
          {#if data.choices.shared.page < data.choices.shared.pageCount}<a href={resolve(`/display/settings?${selected}&sharedPage=${data.choices.shared.page + 1}`)} class="text-teal-800 underline">Next page</a>{/if}
        </nav>
      {/if}
    {:else}<p class="mt-3">Nothing else is shared.</p>{/if}
  </section>
</main>
