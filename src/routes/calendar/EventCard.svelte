<script lang="ts">
  import { summarizeReadiness } from '../../lib/checklists/readiness';
  import { resolve } from '$app/paths';
  import type { PreparationProgress } from '../../lib/server/checklists';
  import Disclosure from './Disclosure.svelte';
  import EventForm from './EventForm.svelte';
  import { viewHeading } from '../../lib/calendar/navigation';
  import { eventTimeLabel } from '../../lib/calendar/presentation';
  import type { EventInput } from '../../lib/server/calendar';
  type Member = { id: string; name: string };
  type Occurrence = { id: string; title: string; date: string; seriesDate: string; startTime: string | null; endTime: string | null; allDay: boolean; weekdays: number[]; participants: string[]; description: string | null; location: string | null; checklists: PreparationProgress[] };
  let { event, members, role, error, action, preparationContext, titleAs = 'h3' }: {
    event: Occurrence;
    members: Member[];
    role: 'parent' | 'kid';
    error?: { id: string; inbox: string; input: EventInput };
    action: (name: string) => string;
    preparationContext: string;
    titleAs?: 'h3' | 'h4';
  } = $props();
  let readiness = $derived(summarizeReadiness(event.checklists));
  let preparationParams = $derived({ eventId: encodeURIComponent(event.id), occurrence: event.date });
</script>
<article class="rounded-2xl bg-white p-5 shadow-sm">
  <svelte:element this={titleAs} class="text-lg font-bold">{event.title}</svelte:element>
  <p class="mt-1 text-sm"><time datetime={event.date}>{viewHeading(event.date, 'day')}</time> · {eventTimeLabel(event)}</p>
  {#if event.location}<p>{event.location}</p>{/if}
  {#if event.description}<p>{event.description}</p>{/if}
  {#if event.participants.length}<p>With: {members.filter(member => event.participants.includes(member.id)).map(member => member.name).join(', ')}</p>{/if}
  {#if event.checklists.length || role === 'parent'}
    <section aria-label="Preparation" class="mt-4 rounded-xl bg-teal-50 p-3">
      <p class="font-bold text-teal-950">Preparation</p>
      {#if readiness.total}
        <p class="mt-1 text-sm font-semibold">Ready: {readiness.completed} of {readiness.total} items</p>
        <p class="text-sm text-slate-700">{readiness.ready ? 'Everything is ready!' : `${readiness.outstanding} ${readiness.outstanding === 1 ? 'thing' : 'things'} still to do`}</p>
      {/if}
      {#if event.checklists.length}
        <ul class="mt-1 divide-y divide-teal-200">
          {#each event.checklists as list (list.id)}
            <li class="py-2">
              <a class="inline-flex min-h-11 items-center break-words font-semibold text-teal-800 underline" href={resolve('/lists/[id]', { id: list.id })}>{list.name}</a>
              <p class="text-sm text-slate-700">{list.completed} of {list.total} items ready</p>
            </li>
          {/each}
        </ul>
      {/if}
      {#if role === 'parent'}
        <div class="mt-1 flex flex-wrap items-center gap-x-4">
          <a class="inline-flex min-h-11 items-center font-semibold text-teal-800 underline" href={resolve(`/lists/preparation/[eventId]/[occurrence]?${preparationContext}#add`, preparationParams)}>Add preparation checklist</a>
          <a class="inline-flex min-h-11 items-center font-semibold text-teal-800 underline" href={resolve(`/lists/preparation/[eventId]/[occurrence]?${preparationContext}#attach`, preparationParams)}>Attach existing checklist</a>
        </div>
      {/if}
    </section>
  {/if}
  {#if role === 'parent'}
    <Disclosure class="mt-3" expanded={error?.id === event.id}><summary class="cursor-pointer font-semibold">Edit event</summary><p class="mt-2 text-sm">Changes apply to the whole series.</p><EventForm initial={error?.id === event.id ? { ...error.input, id: event.id } : { ...event, date: event.seriesDate }} {members} button="Save changes" action={action('saveEvent')} /></Disclosure>
    <form method="POST" action={action('cancel')} class="mt-3"><input type="hidden" name="id" value={event.id} /><button class="rounded-xl border px-4 py-3">Cancel {event.weekdays.length ? 'series' : 'event'}</button></form>
    {#if event.weekdays.length}<form method="POST" action={action('cancel')} class="mt-3"><input type="hidden" name="id" value={event.id} /><input type="hidden" name="occurrence" value={event.date} /><button class="rounded-xl border px-4 py-3">Cancel this occurrence</button></form>{/if}
  {/if}
</article>
