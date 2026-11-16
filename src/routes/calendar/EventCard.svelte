<script lang="ts">
  import Disclosure from './Disclosure.svelte';
  import EventForm from './EventForm.svelte';
  import { viewHeading } from '../../lib/calendar/navigation';
  import { eventTimeLabel } from '../../lib/calendar/presentation';
  import type { EventInput } from '../../lib/server/calendar';
  type Member = { id: string; name: string };
  type Occurrence = { id: string; title: string; date: string; seriesDate: string; startTime: string | null; endTime: string | null; allDay: boolean; weekdays: number[]; participants: string[]; description: string | null; location: string | null };
  let { event, members, role, error, action, titleAs = 'h3' }: {
    event: Occurrence;
    members: Member[];
    role: 'parent' | 'kid';
    error?: { id: string; inbox: string; input: EventInput };
    action: (name: string) => string;
    titleAs?: 'h3' | 'h4';
  } = $props();
</script>
<article class="rounded-2xl bg-white p-5 shadow-sm">
  <svelte:element this={titleAs} class="text-lg font-bold">{event.title}</svelte:element>
  <p class="mt-1 text-sm"><time datetime={event.date}>{viewHeading(event.date, 'day')}</time> · {eventTimeLabel(event)}</p>
  {#if event.location}<p>{event.location}</p>{/if}
  {#if event.description}<p>{event.description}</p>{/if}
  {#if event.participants.length}<p>With: {members.filter(member => event.participants.includes(member.id)).map(member => member.name).join(', ')}</p>{/if}
  {#if role === 'parent'}
    <Disclosure class="mt-3" expanded={error?.id === event.id}><summary class="cursor-pointer font-semibold">Edit event</summary><p class="mt-2 text-sm">Changes apply to the whole series.</p><EventForm initial={error?.id === event.id ? { ...error.input, id: event.id } : { ...event, date: event.seriesDate }} {members} button="Save changes" action={action('saveEvent')} /></Disclosure>
    <form method="POST" action={action('cancel')} class="mt-3"><input type="hidden" name="id" value={event.id} /><button class="rounded-xl border px-4 py-3">Cancel {event.weekdays.length ? 'series' : 'event'}</button></form>
    {#if event.weekdays.length}<form method="POST" action={action('cancel')} class="mt-3"><input type="hidden" name="id" value={event.id} /><input type="hidden" name="occurrence" value={event.date} /><button class="rounded-xl border px-4 py-3">Cancel this occurrence</button></form>{/if}
  {/if}
</article>
