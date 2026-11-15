<script lang="ts">
  import { resolve } from '$app/paths';
  import type { ActionData, PageData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const displayDate = (date: string) => new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'));
</script>

<svelte:head><title>Chore recovery · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-4xl px-4 py-7 text-stone-900 sm:px-6">
  <a href={resolve('/dashboard')} class="inline-block py-2 text-teal-800 underline">Back to My Day</a>
  <h1 class="mt-3 text-3xl font-bold">Review missed dates</h1>
  <p class="mt-3">These dates have no recorded chore or skip. A missing date does not mean work was missed. Leave any date for later, skip it, or create one late chore.</p>
  <p class="mt-2">Past pause, assignment, and reward history may be incomplete. Confirm the child and amount before creating a chore. Only parent verification of submitted work creates earnings.</p>
  {#if form?.message}<p role="alert" class="mt-4 rounded-xl bg-rose-50 p-4">{form.message}</p>{/if}
  {#if data.notice === 'created'}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4">Late chore created. It has not been submitted or earned.</p>{/if}
  {#if data.notice === 'skipped'}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4">Date skipped.</p>{/if}
  <p class="mt-3 text-sm">Showing one recurring chore at a time, for the previous 30 days.</p>
  <nav aria-label="Recovery pages" class="mt-3 flex gap-4">
    {#if data.page > 0}<a class="text-teal-800 underline" href={resolve(`/chores/recovery?page=${data.page - 1}`)}>Previous chore</a>{/if}
    {#if data.hasNext}<a class="text-teal-800 underline" href={resolve(`/chores/recovery?page=${data.page + 1}`)}>Next chore</a>{/if}
  </nav>
  <section aria-label="Dates to review" class="mt-6 grid gap-4">
    {#each data.gaps as gap (gap.seriesId + '/' + gap.date)}
      {@const draft = form?.draft?.seriesId === gap.seriesId && form?.draft?.date === gap.date ? form.draft : undefined}
      <article class="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 class="text-lg font-bold">{gap.title}</h2>
        <p>{gap.childName} · <time datetime={gap.date}>{displayDate(gap.date)}</time></p>
        <p class="mt-2 text-sm">Historical schedule and reward need review. Current series reward: {gap.rewardCents === null ? 'none' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(gap.rewardCents / 100)}.</p>
        <form method="POST" action={'?/decide&page=' + data.page} aria-label={'Create late chore for ' + gap.title + ' on ' + gap.date} class="mt-4 grid gap-3">
          <input type="hidden" name="seriesId" value={gap.seriesId} />
          <input type="hidden" name="date" value={gap.date} />
          <input type="hidden" name="reviewed" value={gap.reviewed} />
          <input type="hidden" name="assigneeId" value={gap.assigneeId} />
          <label>Confirmed reward in dollars <span class="text-sm">(enter 0 for no reward)</span><input name="reward" type="text" inputmode="decimal" required defaultValue={draft?.reward ?? ''} class="mt-1 block w-full rounded-lg border border-stone-400 p-3" /></label>
          <label class="flex items-start gap-2"><input type="checkbox" name="confirmed" value="yes" required defaultChecked={draft?.confirmed ?? false} class="mt-1" />I confirm this late chore for {gap.childName} on {displayDate(gap.date)} and the reward above.</label>
          <button name="decision" value="create" class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Create late chore</button>
        </form>
        <form method="POST" action={'?/decide&page=' + data.page} aria-label={'Skip ' + gap.title + ' on ' + gap.date} class="mt-3">
          <input type="hidden" name="seriesId" value={gap.seriesId} />
          <input type="hidden" name="date" value={gap.date} />
          <input type="hidden" name="reviewed" value={gap.reviewed} />
          <button name="decision" value="skip" class="rounded-xl border border-teal-700 px-4 py-3 font-semibold text-teal-800">Skip this date</button>
        </form>
      </article>
    {:else}<p>No dates need review for eligible active recurring chores in the previous 30 days.</p>{/each}
  </section>
</main>
