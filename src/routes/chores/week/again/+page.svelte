<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import ChildAssigneeChoice from './ChildAssigneeChoice.svelte';
  import ReuseDescriptionField from './ReuseDescriptionField.svelte';
  import type { PageData } from './$types';

  type ReuseFields = { sourceId: string; sourceUpdatedAt: string; title: string; description: string; dueDate: string; reward: string; assigneeIds: string[]; submissionKey: string };
  type ReuseRow = { childId: string; childName: string; title: string; description: string | null; dueDate: string; rewardCents: number | null };
  type ReusePreview = { sourceId: string; sourceUpdatedAt: string; rows: ReuseRow[] };
  type FormResult = { message?: string; reuseError?: ReuseFields; reuseDraft?: ReuseFields; reusePreview?: ReusePreview };
  let { data, form }: { data: PageData; form: FormResult | null } = $props();
  let hydrated = $state(false);
  onMount(() => { hydrated = true; });
  let reuseError = $derived(form?.reuseError);
  let reuseDraft = $derived(form?.reuseDraft);
  let reusePreview = $derived(form?.reusePreview);
  let draft = $derived.by((): ReuseFields | undefined => {
    if (reuseError) return reuseError;
    if (reuseDraft) return reuseDraft;
    if (!data.source) return undefined;
    return {
      sourceId: data.source.id,
      sourceUpdatedAt: data.source.updatedAt,
      title: data.source.title,
      description: data.source.description ?? '',
      dueDate: data.focusDate,
      reward: data.source.rewardCents === null ? '' : (data.source.rewardCents / 100).toFixed(2),
      assigneeIds: data.children.map(child => child.id),
      submissionKey: data.submissionKey
    };
  });
  const money = (cents: number | null) => cents === null ? 'No reward' : `$${(cents / 100).toFixed(2)}`;

  function contextQuery() {
    const params = [`date=${encodeURIComponent(data.focusDate)}`];
    if (data.query) params.push(`q=${encodeURIComponent(data.query)}`);
    if (data.page > 1) params.push(`page=${data.page}`);
    if (data.source) params.push(`source=${encodeURIComponent(data.source.id)}`);
    return params.join('&');
  }

  function sourceQuery(id: string) {
    const params = [`date=${encodeURIComponent(data.focusDate)}`, `source=${encodeURIComponent(id)}`];
    if (data.query) params.push(`q=${encodeURIComponent(data.query)}`);
    if (data.page > 1) params.push(`page=${data.page}`);
    return params.join('&');
  }
</script>
<svelte:head><title>Assign a chore again · Fleck Home Hub</title></svelte:head>
<main data-hydrated={hydrated} class="mx-auto max-w-4xl px-5 py-8">
  <a href={resolve(`/chores/week?week=${data.focusDate}`)} class="text-teal-700">Back to the chore week</a>
  <h1 class="mt-6 text-3xl font-bold">Assign a chore again</h1>
  <p class="mt-2">Reuse a real household chore, then create separate to-do assignments for one or several children.</p>
  {#if form?.message && !reusePreview}<p role="alert" class="mt-4 rounded-xl bg-rose-50 p-4">{form.message}</p>{/if}

  {#if !data.source}
    <form method="GET" action={resolve('/chores/week/again')} class="mt-6 flex flex-wrap items-end gap-3" aria-label="Find a recent chore">
      <input type="hidden" name="date" value={data.focusDate} />
      <label>Search recent chores
        {#key data.query}
          <input name="q" maxlength="80" defaultValue={data.query} class="mt-1 block w-full rounded-lg border p-3" />
        {/key}
      </label>
      <button class="rounded-xl border border-teal-700 px-4 py-3">Search</button>
    </form>
    <p class="mt-4 text-sm">Showing {data.items.length} of {data.total} recent chores.</p>
    {#if data.pageCount > 1}
      <nav aria-label="Recent chore pages" class="mt-3 flex flex-wrap items-center gap-4">
        {#if data.page > 1}<a href={resolve(`/chores/week/again?date=${data.focusDate}&page=${data.page - 1}${data.query ? `&q=${encodeURIComponent(data.query)}` : ''}`)} class="text-teal-800 underline">Previous page</a>{/if}
        <span>Page {data.page} of {data.pageCount}</span>
        {#if data.page < data.pageCount}<a href={resolve(`/chores/week/again?date=${data.focusDate}&page=${data.page + 1}${data.query ? `&q=${encodeURIComponent(data.query)}` : ''}`)} class="text-teal-800 underline">Next page</a>{/if}
      </nav>
    {/if}
    <section aria-label="Recent chores" class="mt-4 grid gap-4">
      {#each data.items as chore (chore.id)}
        <article class="rounded-2xl bg-white p-5 shadow-sm">
          <h2 class="text-lg font-bold">{chore.title}</h2>
          {#if chore.description}<p class="mt-1">{chore.description}</p>{/if}
          <p class="mt-2 text-sm">{chore.childName} · Last used {chore.dueDate} · {money(chore.rewardCents)}</p>
          <a href={resolve(`/chores/week/again?${sourceQuery(chore.id)}`)} class="mt-3 inline-block rounded-xl border border-teal-700 px-4 py-3 text-teal-800">Use this chore</a>
        </article>
      {:else}
        <div class="rounded-2xl bg-white p-5">
          <h2 class="text-xl font-bold">No chores match this search</h2>
          <p class="mt-2">{data.query ? 'Try a shorter search, or clear it to see recent chores.' : 'Create a chore on the weekly board first, then it will appear here for reuse.'}</p>
          <div class="mt-3 flex flex-wrap gap-4">
            {#if data.query}<a href={resolve(`/chores/week/again?date=${data.focusDate}`)} class="py-2 font-semibold text-teal-700 underline">Clear search</a>{/if}
            <a href={resolve(`/chores/week?week=${data.focusDate}&add=1#add-chore`)} class="py-2 font-semibold text-teal-700 underline">Create a new chore</a>
          </div>
        </div>
      {/each}
    </section>
  {:else}
    <section aria-label="Selected chore" class="mt-5 rounded-2xl bg-amber-50 p-5">
      <h2 class="text-xl font-bold">{data.source.title}</h2>
      {#if data.source.description}<p class="mt-1">{data.source.description}</p>{/if}
      <p class="mt-2 text-sm">Based on {data.source.childName}'s chore · {money(data.source.rewardCents)}</p>
    </section>
    {#if draft}
      <section id="reuse-details" class="mt-6 rounded-2xl bg-white p-5 shadow-sm">
        <h2 class="text-xl font-bold">Review the assignments</h2>
        <form method="POST" action={`?/preview&${contextQuery()}`} aria-label={`Assign ${data.source.title} again`} class="mt-4 grid gap-3">
          <input type="hidden" name="sourceId" value={draft.sourceId} />
          <input type="hidden" name="sourceUpdatedAt" value={draft.sourceUpdatedAt} />
          <input type="hidden" name="submissionKey" value={draft.submissionKey} />
          <label>Chore title<input name="title" required maxlength="120" defaultValue={draft.title} class="mt-1 w-full rounded-lg border p-3" /></label>
          <label>Description (optional)<ReuseDescriptionField initial={draft.description} /></label>
          <label>Date<input name="dueDate" type="date" required defaultValue={draft.dueDate} class="mt-1 w-full rounded-lg border p-3" /></label>
          <label>Reward in dollars<input name="reward" type="number" min="0" max="1000000" step="0.01" defaultValue={draft.reward} class="mt-1 w-full rounded-lg border p-3" /></label>
          <fieldset><legend class="font-semibold">Assign to</legend><div class="mt-2 grid gap-2">{#each data.children as child (child.id)}<ChildAssigneeChoice id={child.id} name={child.name} initial={draft.assigneeIds.includes(child.id)} />{/each}</div></fieldset>
          <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Review assignments</button>
        </form>
      </section>
      {#if reusePreview}
        <section aria-label="Assignment preview" class="mt-6 rounded-2xl bg-teal-50 p-5">
          <h2 class="text-xl font-bold">{reusePreview.rows.length} {reusePreview.rows.length === 1 ? 'assignment' : 'assignments'} ready</h2>
          <p class="mt-1 text-sm">Each child gets a separate to-do chore. No earnings are created until a parent verifies completed work.</p>
          <ul class="mt-3 grid gap-2">
            {#each reusePreview.rows as row (row.childId)}
              <li class="rounded-xl bg-white p-3"><strong>{row.childName}</strong> · <time datetime={row.dueDate}>{row.dueDate}</time> · {row.title} · {money(row.rewardCents)}</li>
            {/each}
          </ul>
          <form method="POST" action={`?/create&${contextQuery()}`} class="mt-4" aria-label="Create the reviewed assignments">
            <input type="hidden" name="sourceId" value={draft.sourceId} />
            <input type="hidden" name="sourceUpdatedAt" value={draft.sourceUpdatedAt} />
            <input type="hidden" name="submissionKey" value={draft.submissionKey} />
            <input type="hidden" name="title" value={draft.title} />
            <input type="hidden" name="description" value={draft.description} />
            <input type="hidden" name="dueDate" value={draft.dueDate} />
            <input type="hidden" name="reward" value={draft.reward} />
            {#each draft.assigneeIds as childId (childId)}<input type="hidden" name="assignee" value={childId} />{/each}
            <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Create {reusePreview.rows.length} {reusePreview.rows.length === 1 ? 'assignment' : 'assignments'}</button>
          </form>
          <p class="mt-3 text-sm">Change the fields above and review again to update this preview.</p>
        </section>
      {/if}
    {/if}
  {/if}
</main>
