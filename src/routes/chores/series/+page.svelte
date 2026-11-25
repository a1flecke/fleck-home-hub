<script lang="ts">
  import { resolve } from '$app/paths';
  import Disclosure from '../../calendar/Disclosure.svelte';
  import ScheduleDayChoice from './ScheduleDayChoice.svelte';
  import SeriesDescriptionField from './SeriesDescriptionField.svelte';
  import type { PageData } from './$types';

  type SeriesError = { id: string; title: string; description: string; assignee: string; startDate: string; endDate: string; weekdays: number[]; reward: string };
  type ScheduleFields = { id: string; updatedAt: string; title: string; description: string; assignee: string; effectiveDate: string; endDate: string; weekdays: number[]; reward: string };
  type SchedulePreview = {
    seriesId: string;
    title: string;
    state: string;
    oldPattern: string;
    newPattern: string;
    firstAffectedDate: string;
    addDates: string[];
    keepDates: string[];
    cancelDates: string[];
    preservedDates: string[];
    counts: { add: number; keep: number; cancel: number; preserved: number };
    draft: ScheduleFields;
  };
  type FormResult = { message?: string; seriesError?: SeriesError; scheduleError?: ScheduleFields; schedulePreview?: SchedulePreview };
  let { data, form }: { data: PageData; form: FormResult | null } = $props();
  let seriesError = $derived(form?.seriesError);
  let scheduleError = $derived(form?.scheduleError);
  let schedulePreview = $derived(form?.schedulePreview);
  let newSeries = $derived(seriesError && !seriesError.id ? seriesError : undefined);
  let recurringTitle = $derived(newSeries?.title ?? '');
  let recurringDescription = $derived(newSeries?.description ?? '');
  let recurringEnd = $derived(newSeries?.endDate ?? '');
  let recurringReward = $derived(newSeries?.reward ? Number(newSeries.reward) : undefined);
  let recurringDays = $derived(newSeries?.weekdays ?? []);
  let recurringStart = $derived(newSeries?.startDate ?? data.today);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const money = (cents: number | null) => cents === null ? 'No reward' : `$${(cents / 100).toFixed(2)}`;

  function draftFor(series: PageData['items'][number]) {
    const rejected = scheduleError?.id === series.id ? scheduleError : undefined;
    const proposed = schedulePreview?.seriesId === series.id ? schedulePreview.draft : undefined;
    const values = rejected ?? proposed;
    return {
      id: series.id,
      updatedAt: values?.updatedAt ?? series.updatedAt,
      title: values?.title ?? series.title,
      description: values?.description ?? series.description ?? '',
      assignee: values?.assignee ?? series.assigneeId,
      effectiveDate: values?.effectiveDate ?? (data.tomorrow > series.startDate ? data.tomorrow : series.startDate),
      endDate: values?.endDate ?? series.endDate ?? '',
      weekdays: values?.weekdays ?? JSON.parse(series.weekdays) as number[],
      reward: values?.reward ?? (series.rewardCents === null ? '' : (series.rewardCents / 100).toFixed(2))
    };
  }
</script>
<svelte:head><title>Recurring chores · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-4xl px-5 py-8">
  <a href={resolve('/dashboard')} class="text-teal-700">Back to My Day</a>
  <a href={resolve('/chores/recovery')} class="ml-4 text-teal-700">Review missed dates</a>
  <a href={resolve('/chores/week')} class="ml-4 text-teal-700">Chore week</a>
  <h1 class="mt-6 text-3xl font-bold">Recurring chores</h1>
  <p class="mt-2">Scheduled in {data.timezone}. A schedule change starts on the effective date you choose; today's, submitted, rework and completed chores keep their existing values.</p>
  {#if data.notice === 'revised'}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4 text-teal-900">Schedule updated. Old unstarted dates were removed and completed work is unchanged.</p>{/if}
  {#if form?.message}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4 text-teal-900">{form.message}</p>{/if}
  {#if form?.scheduleError}<p role="alert" class="mt-4 rounded-xl bg-rose-50 p-4">{form.message}</p>{/if}
  <nav aria-label="Schedule pages" class="mt-4 flex flex-wrap gap-4">
    {#if data.page > 1}<a href={resolve(`/chores/series?page=${data.page - 1}`)} class="text-teal-800 underline">Previous page</a>{/if}
    <span>Page {data.page} of {data.pageCount}</span>
    {#if data.page < data.pageCount}<a href={resolve(`/chores/series?page=${data.page + 1}`)} class="text-teal-800 underline">Next page</a>{/if}
  </nav>
  <Disclosure class="mt-6 rounded-2xl bg-white p-5 shadow-sm" expanded={!!newSeries}><summary class="cursor-pointer text-xl font-bold">Add a recurring chore</summary>
    {#if data.children.length}
      <form method="POST" action="?/series" class="mt-4 grid gap-3">
        <label>Recurring chore title<input name="title" required maxlength="120" defaultValue={recurringTitle} class="mt-1 w-full rounded-lg border p-3" /></label>
        <label>Description (optional)<textarea name="description" maxlength="1000" bind:value={recurringDescription} class="mt-1 w-full rounded-lg border p-3"></textarea></label>
        <label>Recurring assigned child<select name="assignee" class="mt-1 w-full rounded-lg border p-3">{#each data.children as child (child.id)}<option value={child.id} selected={child.id === newSeries?.assignee}>{child.name}</option>{/each}</select></label>
        <label>Starts on<input name="startDate" type="date" required bind:value={recurringStart} class="mt-1 w-full rounded-lg border p-3" /></label>
        <label>Ends on (optional)<input name="endDate" type="date" bind:value={recurringEnd} class="mt-1 w-full rounded-lg border p-3" /></label>
        <fieldset><legend class="font-semibold">Repeat on</legend><div class="mt-2 flex flex-wrap gap-3">{#each days as day, index (day)}<ScheduleDayChoice {index} label={day} initial={recurringDays.includes(index)} />{/each}</div></fieldset>
        <label>Recurring reward in dollars<input name="reward" type="number" min="0" max="1000000" step="0.01" defaultValue={recurringReward} class="mt-1 w-full rounded-lg border p-3" /></label>
        <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Add recurring chore</button>
      </form>
    {:else}<p class="mt-3">Add a child account before assigning a recurring chore.</p>{/if}
  </Disclosure>
  <section class="mt-6" aria-labelledby="schedules-heading">
    <h2 id="schedules-heading" class="text-xl font-bold">Schedules</h2>
    {#if !data.items.length}<p class="mt-3 rounded-2xl bg-white p-5">No recurring chores yet.</p>{/if}
    {#each data.items as series (series.id)}
      {@const draft = draftFor(series)}
      <article id={`series-${series.id}`} class="mt-4 rounded-2xl bg-white p-5 shadow-sm"><h3 class="text-lg font-bold">{series.title}</h3><p class="mt-2">{series.state} · {JSON.parse(series.weekdays).map((day: number) => days[day]).join(', ')} · {series.childName}</p>
        <p class="mt-1 text-sm">Effective from {series.effectiveDate}{series.endDate ? ` through ${series.endDate}` : ''} · {money(series.rewardCents)}</p>
        {#if series.state === 'active'}<p>{series.next ? `Next: ${series.next}` : 'No upcoming occurrence in the next seven days.'}</p>{/if}
        {#if series.skips.length}<p>Skipped: {series.skips.join(', ')}{#if series.skipCount > series.skips.length} · {series.skipCount - series.skips.length} older in history{/if}</p>{/if}
        {#if series.state !== 'ended'}
          <details class="mt-3" {...(scheduleError?.id === series.id || schedulePreview?.seriesId === series.id || data.focus === series.id ? { open: true } : {})}><summary class="cursor-pointer font-semibold">Change schedule</summary>
            <form method="POST" action={`?/previewSchedule&page=${data.page}`} class="mt-3 grid gap-3" aria-label={`Change schedule for ${series.title}`}>
              <input type="hidden" name="id" value={series.id} />
              <input type="hidden" name="updatedAt" value={draft.updatedAt} />
              <label>Recurring chore title<input name="title" defaultValue={draft.title} required maxlength="120" class="mt-1 w-full rounded-lg border p-3" /></label>
              <label>Description (optional)<SeriesDescriptionField initial={draft.description} /></label>
              <label>Recurring assigned child<select name="assignee" class="mt-1 w-full rounded-lg border p-3">{#each data.children as child (child.id)}<option value={child.id} selected={child.id === draft.assignee}>{child.name}</option>{/each}</select></label>
              <label>Effective from<input name="effectiveDate" type="date" required defaultValue={draft.effectiveDate} min={data.tomorrow} class="mt-1 w-full rounded-lg border p-3" /></label>
              <label>Ends on (optional)<input name="endDate" type="date" defaultValue={draft.endDate} class="mt-1 w-full rounded-lg border p-3" /></label>
              <fieldset><legend class="font-semibold">Repeat on</legend><div class="mt-2 flex flex-wrap gap-3">{#each days as day, index (day)}<ScheduleDayChoice {index} label={day} initial={draft.weekdays.includes(index)} />{/each}</div></fieldset>
              <label>Recurring reward in dollars<input name="reward" type="number" min="0" max="1000000" step="0.01" defaultValue={draft.reward} class="mt-1 w-full rounded-lg border p-3" /></label>
              <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Preview schedule change</button>
            </form>
          </details>
          {#if schedulePreview?.seriesId === series.id}
            <section aria-label="Proposed schedule change" class="mt-4 rounded-xl bg-amber-50 p-4">
              <h4 class="text-lg font-bold">Review change for {series.title}</h4>
              <p class="mt-2"><strong>Old pattern:</strong> {schedulePreview.oldPattern}</p>
              <p><strong>New pattern:</strong> {schedulePreview.newPattern}</p>
              <p><strong>First affected date:</strong> <time datetime={schedulePreview.firstAffectedDate}>{schedulePreview.firstAffectedDate}</time></p>
              {#if schedulePreview.state === 'paused'}<p class="mt-2 font-semibold">This series is paused. New dates will appear after you resume it.</p>{/if}
              <p class="mt-2">{schedulePreview.counts.add} {schedulePreview.counts.add === 1 ? 'date will be added' : 'dates will be added'}, {schedulePreview.counts.cancel} unstarted {schedulePreview.counts.cancel === 1 ? 'occurrence will be removed' : 'occurrences will be removed'}, {schedulePreview.counts.keep} will stay, and {schedulePreview.counts.preserved} submitted or completed {schedulePreview.counts.preserved === 1 ? 'occurrence stays' : 'occurrences stay'}.</p>
              {#if schedulePreview.addDates.length}<p class="mt-2 text-sm"><strong>Add:</strong> {schedulePreview.addDates.join(', ')}{#if schedulePreview.counts.add > schedulePreview.addDates.length} and more{/if}</p>{/if}
              {#if schedulePreview.cancelDates.length}<p class="mt-2 text-sm"><strong>Remove old unstarted dates:</strong> {schedulePreview.cancelDates.join(', ')}{#if schedulePreview.counts.cancel > schedulePreview.cancelDates.length} and more{/if}</p>{/if}
              {#if schedulePreview.preservedDates.length}<p class="mt-2 text-sm"><strong>Keep submitted or completed:</strong> {schedulePreview.preservedDates.join(', ')}</p>{/if}
              <form method="POST" action={`?/reviseSchedule&page=${data.page}`} class="mt-3" aria-label={`Save schedule change for ${series.title}`}>
                <input type="hidden" name="id" value={series.id} />
                <input type="hidden" name="updatedAt" value={schedulePreview.draft.updatedAt} />
                <input type="hidden" name="title" value={schedulePreview.draft.title} />
                <input type="hidden" name="description" value={schedulePreview.draft.description} />
                <input type="hidden" name="assignee" value={schedulePreview.draft.assignee} />
                <input type="hidden" name="effectiveDate" value={schedulePreview.draft.effectiveDate} />
                <input type="hidden" name="endDate" value={schedulePreview.draft.endDate} />
                {#each schedulePreview.draft.weekdays as weekday (weekday)}<input type="hidden" name="weekday" value={weekday} />{/each}
                <input type="hidden" name="reward" value={schedulePreview.draft.reward} />
                <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Save schedule change</button>
                <a href={resolve(`/chores/series?page=${data.page}#series-${series.id}`)} class="ml-3 inline-block py-3 text-teal-700">Cancel preview</a>
              </form>
            </section>
          {/if}
          <form method="POST" action={`?/seriesControl&page=${data.page}`} class="mt-3 flex flex-wrap gap-3"><input type="hidden" name="id" value={series.id} /><button name="action" value={series.state === 'active' ? 'paused' : 'active'} class="rounded-xl border border-teal-700 px-4 py-3">{series.state === 'active' ? 'Pause' : 'Resume'}</button><button name="action" value="ended" class="rounded-xl border border-teal-700 px-4 py-3">End series</button></form>
          <form method="POST" action={`?/seriesControl&page=${data.page}`} class="mt-3 flex flex-wrap items-end gap-3"><input type="hidden" name="id" value={series.id} /><input type="hidden" name="action" value="skip" /><label>Skip a date<input name="date" type="date" required class="mt-1 block rounded-lg border p-3" /></label><button class="rounded-xl border border-teal-700 px-4 py-3">Skip occurrence</button></form>
        {/if}
      </article>
    {/each}
  </section>
</main>
