<script lang="ts">
  import { resolve } from '$app/paths';
  import EventForm from './EventForm.svelte';
  import InboxForm from './InboxForm.svelte';
  import Disclosure from './Disclosure.svelte';
  import EventCard from './EventCard.svelte';
  import { shiftDate, viewHeading } from '../../lib/calendar/navigation';
  import { groupByDate, monthGrid, monthPreviewLimit } from '../../lib/calendar/presentation';
  import type { PageData } from './$types';
  import type { EventInput } from '../../lib/server/calendar';
  type FormResult = { message: string; eventError?: { id: string; inbox: string; input: EventInput }; inboxError?: { id: string; input: { title: string; description: string; ownerId: string } } };
  let { data, form }: { data: PageData; form: FormResult | null } = $props();
  let selectedDate = $derived(data.date);
  let eventError = $derived(form?.eventError);
  let inboxError = $derived(form?.inboxError);
  let previousDate = $derived(shiftDate(data.date, data.view, -1));
  let nextDate = $derived(shiftDate(data.date, data.view, 1));
  let groups = $derived(groupByDate(data.start, data.end, data.events));
  let weeks = $derived(monthGrid(data.start, data.end, data.events));
  let hasEvents = $derived(data.events.length > 0);
  const action = (name: string) => `?/${name}&date=${data.date}&view=${data.view}`;
  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
</script>
<svelte:head><title>Family calendar · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-4xl px-5 py-8">
  <a href={resolve('/dashboard')} class="text-teal-700">Back to My Day</a>
  <h1 class="mt-6 text-3xl font-bold">Family calendar</h1>
  <p class="mt-2">Times are shown in {data.timezone}.</p>
  {#if form?.message}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4 text-teal-900">{form.message}</p>{/if}
  <nav aria-label="Calendar navigation" class="mt-6 flex flex-wrap items-center gap-2">
    <a href={resolve(`/calendar?date=${encodeURIComponent(previousDate)}&view=${data.view}`)} rel="prev" aria-label={`Previous ${data.view}`} class="rounded-xl border border-teal-700 px-4 py-3">Previous</a>
    <a href={resolve(`/calendar?date=${encodeURIComponent(data.today)}&view=${data.view}`)} class="rounded-xl border border-teal-700 px-4 py-3">Today</a>
    <a href={resolve(`/calendar?date=${encodeURIComponent(nextDate)}&view=${data.view}`)} rel="next" aria-label={`Next ${data.view}`} class="rounded-xl border border-teal-700 px-4 py-3">Next</a>
  </nav>
  <h2 class="mt-4 text-xl font-bold">{data.heading}</h2>
  <form method="GET" class="mt-6 flex flex-wrap items-end gap-3">
    <label>Choose date<input type="date" name="date" bind:value={selectedDate} class="mt-1 block rounded-lg border p-3" /></label>
    <label>View<select name="view" class="mt-1 block rounded-lg border p-3"><option value="day" selected={data.view === 'day'}>Day</option><option value="week" selected={data.view === 'week'}>Week</option><option value="month" selected={data.view === 'month'}>Month</option></select></label>
    <button class="rounded-xl border border-teal-700 px-4 py-3">Show calendar</button>
  </form>
  {#if data.view === 'day'}
    <div class="mt-6">
      {#if !hasEvents}<p>Nothing scheduled for this date.</p>{/if}
      <div class="grid gap-4">
        {#each data.events as event (`${event.id}-${event.date}`)}
          <EventCard {event} members={data.members} role={data.role} error={eventError} {action} titleAs="h3" />
        {/each}
      </div>
    </div>
  {:else if data.view === 'week'}
    <div class="mt-6 space-y-6">
      {#each groups as group (group.date)}
        <section aria-labelledby={`day-${group.date}`}>
          <h3 id={`day-${group.date}`} class="text-lg font-bold">{viewHeading(group.date, 'day')}</h3>
          {#if !group.events.length}<p class="mt-2 text-sm">No events.</p>{/if}
          <div class="mt-3 grid gap-4 md:grid-cols-2">
            {#each group.events as event (`${event.id}-${event.date}`)}
              <EventCard {event} members={data.members} role={data.role} error={eventError} {action} titleAs="h4" />
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {:else}
    <div class="mt-6">
      <div aria-hidden="true" class="hidden lg:grid lg:grid-cols-7 lg:gap-1">
        {#each weekdayLabels as label (label)}<div class="px-2 py-1 text-center text-xs font-semibold uppercase tracking-wide">{label}</div>{/each}
      </div>
      <div class="mt-2 grid grid-cols-1 gap-2 lg:mt-1 lg:grid-cols-7 lg:gap-1">
        {#each weeks as week, weekIndex (weekIndex)}
          {#each week as cell, cellIndex (cell?.date ?? `pad-${weekIndex}-${cellIndex}`)}
            {#if !cell}
              <div aria-hidden="true" class="hidden lg:block lg:min-h-28"></div>
            {:else}
              <div class="rounded-xl bg-white p-4 shadow-sm lg:block lg:min-h-28 lg:rounded-md lg:border lg:border-teal-100 lg:p-2 lg:shadow-none" class:hidden={!cell.events.length}>
                <h3 class="text-sm font-bold"><a href={resolve(`/calendar?date=${cell.date}&view=day`)} aria-label={`View ${viewHeading(cell.date, 'day')}`} class="text-teal-800 underline"><span class="lg:hidden">{viewHeading(cell.date, 'day')}</span><span class="hidden lg:inline">{cell.day}</span></a></h3>
                {#if cell.events.length}
                  <ul class="mt-2 space-y-1">
                    {#each cell.events as event, index (event.id)}
                      <li class={index >= monthPreviewLimit ? 'lg:hidden' : ''}><a href={resolve(`/calendar?date=${cell.date}&view=day`)} class="block text-sm leading-5 text-teal-900 lg:truncate"><span class="font-semibold">{event.allDay ? 'All day' : event.startTime}</span> {event.title}</a></li>
                    {/each}
                  </ul>
                  {#if cell.hiddenCount > 0}<a href={resolve(`/calendar?date=${cell.date}&view=day`)} aria-label={`+${cell.hiddenCount} more events on ${viewHeading(cell.date, 'day')}`} class="mt-2 hidden text-sm font-semibold text-teal-800 underline lg:inline">+{cell.hiddenCount} more</a>{/if}
                {:else}
                  <p class="mt-2 hidden text-xs lg:block">No events</p>
                {/if}
              </div>
            {/if}
          {/each}
        {/each}
      </div>
      {#if !hasEvents}<p class="mt-4 lg:hidden">Nothing scheduled this month.</p>{/if}
    </div>
  {/if}
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
