<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { viewHeading } from '../../../../lib/calendar/navigation';
  import { eventTimeLabel } from '../../../../lib/calendar/presentation';
  import type { PageData } from './$types';

  type Form = { message: string; draft?: { selected: string; token: string }; removeToken?: string };
  let { data, form }: { data: PageData; form: Form | null } = $props();
  let choices = $derived(data.events.map(event => ({ ...event, value: `${event.id}/${event.date}` })));
  let eventField = $state<HTMLSelectElement>();
  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
    if (form?.draft && document.activeElement === document.body) eventField?.focus();
  });
</script>

<svelte:head><title>Link to calendar event · Family lists</title></svelte:head>
<main data-hydrated={hydrated} class="mx-auto max-w-3xl px-4 py-7 text-slate-900">
  <a class="inline-flex min-h-11 items-center font-semibold text-teal-800 underline" href={resolve('/lists/[id]', { id: data.list.id })}>← Back to checklist</a>
  <h1 class="mt-2 text-3xl font-bold">Link to calendar event</h1>
  <p class="mt-2 break-words font-semibold">{data.list.name}</p>
  {#if form?.message}
    <p role="alert" class="mt-3 rounded-xl bg-amber-100 p-3">{form.message}</p>
    <a class="inline-flex min-h-11 items-center font-semibold text-teal-800 underline" href={resolve(`/lists/[id]/event?date=${data.date}`, { id: data.list.id })} data-sveltekit-reload>Reload link</a>
  {/if}
  {#if data.link}
    <section aria-label="Current calendar link" class="mt-4 rounded-xl bg-teal-50 p-4">
      <p class="font-bold">Current link</p>
      <p class="mt-1 break-words">{data.link.title} · {viewHeading(data.link.date, 'day')}</p>
      {#if data.link.stale}<p class="mt-1 text-sm">This date was cancelled or moved. Choose another event or remove this link.</p>{/if}
      <form method="POST" action={`?/remove&date=${data.date}`} aria-label="Remove calendar link" class="mt-3">
        <input type="hidden" name="token" value={form?.removeToken ?? data.link.token} />
        <button class="min-h-11 rounded-xl border border-slate-400 px-3 py-2 font-semibold">Remove calendar link</button>
      </form>
    </section>
  {/if}
  {#if !data.list.archived}
    <section class="mt-4 rounded-2xl bg-white p-4 shadow-sm">
      <h2 class="text-xl font-bold">Choose an event date</h2>
      <p class="mt-1 text-sm">See events for two weeks starting on the date you choose.</p>
      <form method="GET" aria-label="Find calendar events" class="mt-3 flex flex-wrap items-end gap-3">
        <label>Starting date
          <input name="date" required type="date" defaultValue={data.date} class="mt-1 block rounded-lg border p-3" />
        </label>
        <button class="min-h-11 rounded-xl border border-teal-700 px-3 font-semibold text-teal-800">Show events</button>
      </form>
      {#if !choices.length}<p class="mt-4">There are no events in this range. Try another date.</p>{/if}
      {#if choices.length || form?.draft?.selected}
        <form method="POST" action={`?/link&date=${data.date}`} aria-label="Choose a calendar event" class="mt-4 grid gap-3">
          <input type="hidden" name="token" value={form?.draft?.token ?? data.link?.token ?? ''} />
          <label>Calendar event
            <select bind:this={eventField} name="occurrence" required class="mt-1 block w-full rounded-lg border p-3">
              <option value="" selected={!form?.draft?.selected}>Choose an event</option>
              {#if form?.draft?.selected && !choices.some(event => event.value === form?.draft?.selected)}
                <option value={form.draft.selected} selected>Previously selected event</option>
              {/if}
              {#each choices as event (event.value)}
                <option value={event.value} selected={event.value === form?.draft?.selected}>{event.title} · {viewHeading(event.date, 'day')} · {eventTimeLabel(event)}</option>
              {/each}
            </select>
          </label>
          <button disabled={!choices.length} class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white disabled:bg-slate-500">Save calendar link</button>
        </form>
      {/if}
    </section>
  {/if}
</main>
