<script lang="ts">
  import { resolve } from '$app/paths';
  import { groupReviewItems } from '../../lib/chores/review';
  import type { PageData } from './$types';
  type ReviewError = { id: string; action: string; reason: string };
  type FormResult = { message: string; reviewError?: ReviewError };
  let { data, form }: { data: PageData; form: FormResult | null } = $props();
  const localDate = (timestamp: string) => {
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: data.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed);
  };
  let groups = $derived(groupReviewItems(data.items, localDate));
  let childGroups = $derived.by(() => {
    const children: { childId: string; childName: string; pendingCents: number; dates: typeof groups }[] = [];
    for (const group of groups) {
      let child = children.find(item => item.childId === group.childId);
      if (!child) {
        child = { childId: group.childId, childName: group.childName, pendingCents: 0, dates: [] };
        children.push(child);
      }
      child.dates.push(group);
      child.pendingCents += group.pendingCents;
    }
    return children;
  });
  let reasons = $derived.by(() => {
    let values: Record<string, string> = $state(Object.fromEntries(data.items.map(chore => [chore.id, form?.reviewError?.id === chore.id ? form.reviewError.reason : ''])));
    return values;
  });
  let summaryById = $derived(new Map(data.summaries.map(summary => [summary.id, summary])));
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const dateLabel = (date: string) => {
    const parsed = new Date(`${date}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? 'Unknown date' : new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(parsed);
  };
</script>
<svelte:head><title>Review completed chores · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-4xl px-5 py-8">
  <a href={resolve('/dashboard')} class="text-teal-700">Back to My Day</a>
  <h1 class="mt-6 text-3xl font-bold">Review completed chores</h1>
  <p class="mt-2">Verify work to record its reward, or return it with a reason. Pending rewards are not earned until you verify them.</p>
  <section aria-label="Review summary" class="mt-5 rounded-2xl bg-amber-50 p-5">
    <h2 class="text-xl font-bold">Pending review</h2>
    <p class="mt-2">{data.pendingCount} {data.pendingCount === 1 ? 'submission' : 'submissions'} · {money(data.pendingCents)} in pending rewards</p>
    <p class="mt-1 text-sm">Pending rewards are not part of a child's verified balance. Verification records the reward exactly once.</p>
    <p class="mt-2">Verified earnings owed so far: {money(data.verifiedOwed)}</p>
  </section>
  {#if data.notice === 'verified'}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4">Chore verified. Its reward was recorded once in verified earnings.</p>{/if}
  {#if data.notice === 'rework'}<p role="status" class="mt-4 rounded-xl bg-amber-50 p-4">Work returned for rework. No reward was created.</p>{/if}
  {#if form?.message}<p role="alert" class="mt-4 rounded-xl bg-rose-50 p-4">{form.message}</p>{/if}
  <nav aria-label="Filter by child" class="mt-5 flex flex-wrap gap-x-4 gap-y-2">
    <a href={resolve('/verify')} class="text-teal-800 underline" aria-current={!data.childId ? 'page' : undefined}>All children ({data.pendingCount})</a>
    {#each data.children as child (child.id)}
      <a href={resolve(`/verify?child=${encodeURIComponent(child.id)}`)} class="text-teal-800 underline" aria-current={data.childId === child.id ? 'page' : undefined}>{child.name} ({summaryById.get(child.id)?.pendingCount ?? 0})</a>
    {/each}
  </nav>
  <p class="mt-5 text-sm">Showing {data.items.length} of {data.total} submissions{data.childId ? ' for this child' : ''}.</p>
  {#if data.pageCount > 1}
    <nav aria-label="Review queue pages" class="mt-3 flex flex-wrap items-center gap-4">
      {#if data.page > 1}<a href={resolve(`/verify?page=${data.page - 1}${data.childId ? `&child=${encodeURIComponent(data.childId)}` : ''}`)} class="text-teal-800 underline">Previous page</a>{/if}
      <span>Page {data.page} of {data.pageCount}</span>
      {#if data.page < data.pageCount}<a href={resolve(`/verify?page=${data.page + 1}${data.childId ? `&child=${encodeURIComponent(data.childId)}` : ''}`)} class="text-teal-800 underline">Next page</a>{/if}
    </nav>
  {/if}
  {#if !data.items.length}
    <p class="mt-6 rounded-2xl bg-white p-5">No completed chores are waiting for review. Children see rewards only after verification.</p>
  {/if}
  {#each childGroups as child (child.childId)}
    <section class="mt-6" aria-label={`Submissions for ${child.childName}`}>
      <h2 class="text-xl font-bold">{child.childName}</h2>
      <p class="text-sm">On this page: {child.dates.reduce((total, group) => total + group.items.length, 0)} submissions · {money(child.pendingCents)} pending</p>
      {#each child.dates as group (group.key)}
        <div class="mt-4">
          <h3 class="text-lg font-semibold">{dateLabel(group.date)}</h3>
          <p class="text-sm">{group.items.length} {group.items.length === 1 ? 'submission' : 'submissions'} · {money(group.pendingCents)} pending</p>
          {#each group.items as chore (chore.id)}
            <article class="mt-4 rounded-2xl bg-white p-5 shadow-sm" aria-label={`Review ${chore.title}`}>
              <h4 class="text-lg font-bold">{chore.title}</h4>
              {#if chore.description}<p class="mt-1">{chore.description}</p>{/if}
              <p class="mt-2 text-sm">Due {chore.dueDate} · <strong>{chore.rewardCents === null ? 'No reward' : `${money(chore.rewardCents)} pending reward`}</strong></p>
              <p class="text-sm">Not yet earned until verified.</p>
              <form method="POST" action={'?/review&page=' + data.page + (data.childId ? '&child=' + encodeURIComponent(data.childId) : '')} class="mt-4 grid gap-3">
                <input type="hidden" name="id" value={chore.id} />
                <label>Reason for returning work <span class="text-sm">(required only when returning it)</span><textarea name="reason" maxlength="1000" bind:value={reasons[chore.id]} class="mt-1 block w-full rounded-lg border p-3"></textarea></label>
                <div class="flex flex-wrap gap-3">
                  <button name="action" value="verify" class="rounded-xl bg-teal-700 px-5 py-3 font-bold text-white">{chore.rewardCents === null ? 'Verify' : `Verify and record ${money(chore.rewardCents)}`}</button>
                  <button name="action" value="rework" class="rounded-xl border border-teal-700 px-5 py-3 font-semibold text-teal-800">Return for rework</button>
                </div>
              </form>
            </article>
          {/each}
        </div>
      {/each}
    </section>
  {/each}
  {#if data.pageCount > 1}
    <nav aria-label="Review queue pages" class="mt-6 flex flex-wrap items-center gap-4">
      {#if data.page > 1}<a href={resolve(`/verify?page=${data.page - 1}${data.childId ? `&child=${encodeURIComponent(data.childId)}` : ''}`)} class="text-teal-800 underline">Previous page</a>{/if}
      <span>Page {data.page} of {data.pageCount}</span>
      {#if data.page < data.pageCount}<a href={resolve(`/verify?page=${data.page + 1}${data.childId ? `&child=${encodeURIComponent(data.childId)}` : ''}`)} class="text-teal-800 underline">Next page</a>{/if}
    </nav>
  {/if}
</main>
