<script lang="ts">
  import { resolve } from '$app/paths';
  import EventForm from './EventForm.svelte';
  import InboxForm from './InboxForm.svelte';
  import Disclosure from './Disclosure.svelte';
  import type { PageData } from './$types';
  import type { EventInput } from '../../lib/server/calendar';
  type FormResult = { message: string; eventError?: { id: string; inbox: string; input: EventInput }; inboxError?: { id: string; input: { title: string; description: string; ownerId: string } } };
  let { data, form }: { data: PageData; form: FormResult | null } = $props();
  let selectedDate = $derived(data.date);
  let eventError = $derived(form?.eventError);
  let inboxError = $derived(form?.inboxError);
  const action = (name: string) => `?/${name}&date=${data.date}&view=${data.view}`;
</script>
<svelte:head><title>Family calendar · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-4xl px-5 py-8">
  <a href={resolve('/dashboard')} class="text-teal-700">Back to My Day</a>
  <h1 class="mt-6 text-3xl font-bold">Family calendar</h1>
  <p class="mt-2">Times are shown in {data.timezone}.</p>
  {#if form?.message}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4 text-teal-900">{form.message}</p>{/if}
  <form method="GET" class="mt-6 flex flex-wrap items-end gap-3">
    <label>Choose date<input type="date" name="date" bind:value={selectedDate} class="mt-1 block rounded-lg border p-3" /></label>
    <label>View<select name="view" class="mt-1 block rounded-lg border p-3"><option value="day" selected={data.view === 'day'}>Day</option><option value="week" selected={data.view === 'week'}>Week</option><option value="month" selected={data.view === 'month'}>Month</option></select></label>
    <button class="rounded-xl border border-teal-700 px-4 py-3">Show calendar</button>
  </form>
  <h2 class="mt-6 text-xl font-bold">{data.start}{data.start === data.end ? '' : ` – ${data.end}`}</h2>
  {#if !data.events.length}<p class="mt-4">Nothing scheduled for these dates.</p>{/if}
  {#each data.events as event (`${event.id}-${event.date}`)}
    <article class="mt-4 rounded-2xl bg-white p-5 shadow-sm">
      <h3 class="text-lg font-bold">{event.title}</h3><p>{event.date} · {event.allDay ? 'All day' : `${event.startTime}–${event.endTime}`}</p>
      {#if event.location}<p>{event.location}</p>{/if}{#if event.description}<p>{event.description}</p>{/if}
      {#if event.participants.length}<p>With: {data.members.filter(member => event.participants.includes(member.id)).map(member => member.name).join(', ')}</p>{/if}
      {#if data.role === 'parent'}
        <Disclosure class="mt-3" expanded={eventError?.id === event.id}><summary class="cursor-pointer font-semibold">Edit event</summary><p class="mt-2 text-sm">Changes apply to the whole series.</p><EventForm initial={eventError?.id === event.id ? { ...eventError.input, id: event.id } : { ...event, date: event.seriesDate }} members={data.members} button="Save changes" action={action('saveEvent')} /></Disclosure>
        <form method="POST" action={action('cancel')} class="mt-3"><input type="hidden" name="id" value={event.id} /><button class="rounded-xl border px-4 py-3">Cancel {event.weekdays.length ? 'series' : 'event'}</button></form>
        {#if event.weekdays.length}<form method="POST" action={action('cancel')} class="mt-3"><input type="hidden" name="id" value={event.id} /><input type="hidden" name="occurrence" value={event.date} /><button class="rounded-xl border px-4 py-3">Cancel this date</button></form>{/if}
      {/if}
    </article>
  {/each}
  {#if data.role === 'parent'}
    <Disclosure class="mt-6 rounded-2xl bg-white p-5 shadow-sm" expanded={!!eventError && !eventError.id && !eventError.inbox}><summary class="cursor-pointer text-xl font-bold">Add an event</summary><EventForm initial={eventError && !eventError.id && !eventError.inbox ? eventError.input : { date: data.date }} members={data.members} button="Save event" action={action('saveEvent')} /></Disclosure>
  {/if}
  <section class="mt-8"><h2 class="text-2xl font-bold">To schedule</h2><p class="mt-2">Plans waiting for a date.</p>
    {#if !data.inbox.length}<p class="mt-3">No plans waiting to be scheduled.</p>{/if}
    {#each data.inbox as item (item.id)}<article class="mt-4 rounded-2xl bg-white p-5 shadow-sm"><h3 class="font-bold">{item.title}</h3>{#if item.description}<p>{item.description}</p>{/if}
      {#if data.role === 'parent'}<Disclosure class="mt-3" expanded={inboxError?.id === item.id}><summary class="cursor-pointer font-semibold">Edit item</summary><InboxForm item={inboxError?.id === item.id ? { ...inboxError.input, id: item.id } : item} members={data.members} button="Save item" action={action('addInbox')} /></Disclosure><Disclosure class="mt-3" expanded={eventError?.inbox === item.id}><summary class="cursor-pointer font-semibold">Schedule this</summary><EventForm initial={eventError?.inbox === item.id ? { ...eventError.input, inbox: item.id } : { inbox: item.id, title: item.title, description: item.description, date: data.date, participants: item.ownerId ? [item.ownerId] : [] }} members={data.members} button="Schedule event" action={action('saveEvent')} /></Disclosure><form method="POST" action={action('archive')} class="mt-3"><input type="hidden" name="id" value={item.id} /><button class="rounded-xl border px-4 py-3">Archive item</button></form>{/if}
    </article>{/each}
    {#if data.role === 'parent'}<Disclosure class="mt-4 rounded-2xl bg-white p-5 shadow-sm" expanded={!!inboxError && !inboxError.id}><summary class="cursor-pointer font-bold">Add to the inbox</summary><InboxForm item={inboxError && !inboxError.id ? inboxError.input : {}} members={data.members} button="Add item" action={action('addInbox')} /></Disclosure>{/if}
  </section>
</main>
