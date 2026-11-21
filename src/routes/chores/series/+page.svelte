<script lang="ts">
  import { resolve } from '$app/paths';
  import Disclosure from '../../calendar/Disclosure.svelte';
  import type { PageData } from './$types';
  type SeriesError = { id: string; title: string; description: string; assignee: string; startDate: string; endDate: string; weekdays: number[]; reward: string };
  type FormResult = { message: string; seriesError?: SeriesError };
  let { data, form }: { data: PageData; form: FormResult | null } = $props();
  let seriesError = $derived(form?.seriesError);
  let newSeries = $derived(seriesError && !seriesError.id ? seriesError : undefined);
  let recurringTitle = $derived(newSeries?.title ?? '');
  let recurringDescription = $derived(newSeries?.description ?? '');
  let recurringEnd = $derived(newSeries?.endDate ?? '');
  let recurringReward = $derived(newSeries?.reward ? Number(newSeries.reward) : undefined);
  let recurringDays = $derived(newSeries?.weekdays ?? []);
  let recurringStart = $derived(newSeries?.startDate ?? data.today);
  let recurringSeries = $derived.by(() => {
    let values = $state(data.items.map(series => {
      const rejected = seriesError?.id === series.id ? seriesError : undefined;
      return { ...series, editTitle: rejected?.title ?? series.title, editDescription: rejected?.description ?? series.description, editAssignee: rejected?.assignee ?? series.assigneeId, editReward: rejected ? (rejected.reward ? Number(rejected.reward) : undefined) : series.rewardCents === null ? undefined : series.rewardCents / 100 };
    }));
    return values;
  });
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
</script>
<svelte:head><title>Recurring chores · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-4xl px-5 py-8">
  <a href={resolve('/dashboard')} class="text-teal-700">Back to My Day</a>
  <a href={resolve('/chores/recovery')} class="ml-4 text-teal-700">Review missed dates</a>
  <h1 class="mt-6 text-3xl font-bold">Recurring chores</h1>
  <p class="mt-2">Scheduled in {data.timezone}. Changes apply to future unstarted occurrences. Today's and historical chores keep their existing values.</p>
  {#if form?.message}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4 text-teal-900">{form.message}</p>{/if}
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
        <fieldset><legend class="font-semibold">Repeat on</legend><div class="mt-2 flex flex-wrap gap-3">{#each days as day, index (day)}<label class="flex items-center gap-2"><input name="weekday" type="checkbox" value={index} bind:group={recurringDays} />{day}</label>{/each}</div></fieldset>
        <label>Recurring reward in dollars<input name="reward" type="number" min="0" max="1000000" step="0.01" defaultValue={recurringReward} class="mt-1 w-full rounded-lg border p-3" /></label>
        <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Add recurring chore</button>
      </form>
    {:else}<p class="mt-3">Add a child account before assigning a recurring chore.</p>{/if}
  </Disclosure>
  <section class="mt-6" aria-labelledby="schedules-heading">
    <h2 id="schedules-heading" class="text-xl font-bold">Schedules</h2>
    {#if !recurringSeries.length}<p class="mt-3 rounded-2xl bg-white p-5">No recurring chores yet.</p>{/if}
    {#each recurringSeries as series (series.id)}
      <article class="mt-4 rounded-2xl bg-white p-5 shadow-sm"><h3 class="text-lg font-bold">{series.title}</h3><p class="mt-2">{series.state} · {JSON.parse(series.weekdays).map((day: number) => days[day]).join(', ')} · {series.childName}</p>
        {#if series.state === 'active'}<p>{series.next ? `Next: ${series.next}` : 'No upcoming occurrence in the next seven days.'}</p>{/if}
        {#if series.skips.length}<p>Skipped: {series.skips.join(', ')}{#if series.skipCount > series.skips.length} · {series.skipCount - series.skips.length} older in history{/if}</p>{/if}
        {#if series.state !== 'ended'}
          <Disclosure class="mt-3" expanded={seriesError?.id === series.id}><summary class="cursor-pointer font-semibold">Edit future chores</summary>
            <form method="POST" action={`?/series&page=${data.page}`} class="mt-3 grid gap-3">
              <input type="hidden" name="id" value={series.id} /><input type="hidden" name="startDate" value={series.startDate} /><input type="hidden" name="endDate" value={series.endDate ?? ''} />
              {#each JSON.parse(series.weekdays) as day (day)}<input type="hidden" name="weekday" value={day} />{/each}
              <label>Recurring chore title<input name="title" defaultValue={series.editTitle} required maxlength="120" class="mt-1 w-full rounded-lg border p-3" /></label>
              <label>Description (optional)<textarea name="description" maxlength="1000" bind:value={series.editDescription} class="mt-1 w-full rounded-lg border p-3"></textarea></label>
              <label>Recurring assigned child<select name="assignee" class="mt-1 w-full rounded-lg border p-3">{#each data.children as child (child.id)}<option value={child.id} selected={child.id === series.editAssignee}>{child.name}</option>{/each}</select></label>
              <label>Recurring reward in dollars<input name="reward" type="number" min="0" max="1000000" step="0.01" defaultValue={series.editReward} class="mt-1 w-full rounded-lg border p-3" /></label>
              <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Save changes</button>
            </form>
          </Disclosure>
          <form method="POST" action={`?/seriesControl&page=${data.page}`} class="mt-3 flex flex-wrap gap-3"><input type="hidden" name="id" value={series.id} /><button name="action" value={series.state === 'active' ? 'paused' : 'active'} class="rounded-xl border border-teal-700 px-4 py-3">{series.state === 'active' ? 'Pause' : 'Resume'}</button><button name="action" value="ended" class="rounded-xl border border-teal-700 px-4 py-3">End series</button></form>
          <form method="POST" action={`?/seriesControl&page=${data.page}`} class="mt-3 flex flex-wrap items-end gap-3"><input type="hidden" name="id" value={series.id} /><input type="hidden" name="action" value="skip" /><label>Skip a date<input name="date" type="date" required class="mt-1 block rounded-lg border p-3" /></label><button class="rounded-xl border border-teal-700 px-4 py-3">Skip occurrence</button></form>
        {/if}
      </article>
    {/each}
  </section>
</main>
