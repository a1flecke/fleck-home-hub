<script lang="ts">
  import { resolve } from '$app/paths';
  import ImportEventRow from './ImportEventRow.svelte';
  import { MAX_ICS_EVENTS, type ImportReview } from '../../../lib/calendar/ics';
  import type { PageData } from './$types';

  type ImportFormResult = {
    message?: string;
    ics?: string;
    sourceName?: string;
    importKey?: string;
    review?: ImportReview;
  };

  let { data, form }: { data: PageData; form: ImportFormResult | null } = $props();
  let ics = $derived(form?.ics ?? '');
  const action = (name: string) => `?/${name}&date=${encodeURIComponent(data.date)}&view=${data.view}`;
</script>
<svelte:head><title>Import calendar · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-4xl px-5 py-8">
  <a href={resolve(`/calendar?date=${encodeURIComponent(data.date)}&view=${data.view}`)} class="text-teal-700 underline">Back to family calendar</a>
  <h1 class="mt-5 text-3xl font-bold">Import calendar (.ics)</h1>
  <p class="mt-2">Upload a calendar file or paste iCalendar text from a school, sports team, or email invite. Times are converted to {data.timezone}.</p>
  <p class="mt-1 text-sm text-slate-700">Up to {MAX_ICS_EVENTS} events and 256 KB per import. Nothing is added until you review and confirm. Imported events are private by default and stay off the family display until you choose to share them.</p>

  {#if !form?.review}
    <form method="POST" action={action('review')} enctype="multipart/form-data" aria-label="Upload or paste an iCalendar file" class="mt-6 grid gap-4 rounded-2xl bg-white p-5 shadow-sm">
      {#if form?.message}<p role="alert" class="rounded-xl bg-amber-50 p-3 text-amber-950">{form.message}</p>{/if}
      <label class="block">
        <span class="font-bold">Choose a .ics file</span>
        <input type="file" name="file" accept=".ics,text/calendar" class="mt-2 block w-full rounded-lg border p-3" />
      </label>
      <label class="block">
        <span class="font-bold">Or paste iCalendar text</span>
        <span class="mt-1 block text-sm text-slate-700">Starts with BEGIN:VCALENDAR and contains VEVENT entries.</span>
        <textarea name="ics" rows="8" bind:value={ics} class="mt-2 block w-full rounded-xl border p-3 font-mono text-sm"></textarea>
      </label>
      <div class="flex flex-wrap items-center gap-3">
        <button class="rounded-xl bg-teal-700 px-5 py-3 font-bold text-white">Review events</button>
        <a href={resolve(`/calendar?date=${encodeURIComponent(data.date)}&view=${data.view}`)} class="py-3 text-teal-700 underline">Cancel</a>
      </div>
    </form>
  {:else}
    <section aria-label="Review imported calendar events" class="mt-6 rounded-2xl bg-white p-5 shadow-sm">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-2xl font-bold">Review {form.review.items.length} {form.review.items.length === 1 ? 'event' : 'events'}{form.sourceName ? ` from ${form.sourceName}` : ''}</h2>
        <p class="rounded-full bg-teal-50 px-3 py-1 text-sm font-bold text-teal-900">{form.review.toImport} to import · {form.review.toSkip} skipped</p>
      </div>
      {#if form.message}<p role="alert" class="mt-3 rounded-xl bg-amber-50 p-3 text-amber-950">{form.message}</p>{/if}
      <p class="mt-2 text-sm text-slate-700">Times are shown in {form.review.timezone}. Existing household events are never overwritten.</p>

      <form method="POST" action={action('confirm')} aria-label="Confirm calendar import" class="mt-5 grid gap-5">
        <input type="hidden" name="rowCount" value={form.review.items.length} />
        <input type="hidden" name="importKey" value={form.importKey ?? ''} />

        {#each form.review.items as item, index (item.key)}
          <ImportEventRow {item} {index} members={data.members} />
        {/each}

        <div class="flex flex-wrap items-center gap-3">
          <button class="rounded-xl bg-teal-700 px-5 py-3 font-bold text-white">Import selected events</button>
          <a href={resolve(`/calendar/import?date=${encodeURIComponent(data.date)}&view=${data.view}`)} class="py-3 text-teal-700 underline">Choose a different file</a>
          <a href={resolve(`/calendar?date=${encodeURIComponent(data.date)}&view=${data.view}`)} class="py-3 text-teal-700 underline">Cancel without saving</a>
        </div>
      </form>
    </section>
  {/if}
</main>
