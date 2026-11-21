<script lang="ts">
  import { resolve } from '$app/paths';
  import type { PageData } from './$types';
  type FormResult = { message: string };
  let { data, form }: { data: PageData; form: FormResult | null } = $props();
  const scopes = ['review', 'overdue', 'today', 'upcoming', 'later', 'rework', 'verified'] as const;
  const labels = { review: 'Waiting for review', overdue: 'Overdue', today: 'Due today', upcoming: 'Coming up', later: 'Later', rework: 'Needs rework', verified: 'Completed' } as const;
  const money = (cents: number | null) => cents === null ? 'No reward' : `$${(cents / 100).toFixed(2)}`;
  // A named action replaces the whole query string, so carry the selected scope, page and child.
  let transitionAction = $derived(`?/transition&scope=${data.scope}&page=${data.page}${data.childId ? `&child=${encodeURIComponent(data.childId)}` : ''}`);
  // Matches My Day: a child can finish work that is due or returned, not work that is still ahead.
  const canSubmit = (chore: PageData['items'][number]) => (chore.status === 'todo' && chore.dueDate <= data.today) || chore.status === 'needs_rework';
</script>
<svelte:head><title>Chore history · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-4xl px-5 py-8">
  <a href={resolve('/dashboard')} class="text-teal-700">Back to My Day</a>
  <h1 class="mt-6 text-3xl font-bold">{data.role === 'parent' ? 'Family chore history' : 'My chore history'}</h1>
  <p class="mt-2">All dates for {data.role === 'parent' ? 'your household' : 'your chores'}, in a stable order. Older work stays reachable here.</p>
  {#if data.notice === 'verified'}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4">Chore verified. Its reward is now part of the verified balance.</p>{/if}
  {#if data.notice === 'rework'}<p role="status" class="mt-4 rounded-xl bg-amber-50 p-4">Chore returned for rework. No reward was created.</p>{/if}
  {#if data.notice === 'submitted'}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4">Nice job! Waiting for a parent to check.</p>{/if}
  {#if form?.message}<p role="alert" class="mt-4 rounded-xl bg-rose-50 p-4">{form.message}</p>{/if}
  {#if data.role === 'parent' && data.children.length}
    <nav aria-label="Filter by child" class="mt-5 flex flex-wrap gap-x-4 gap-y-2">
      <a href={resolve(`/chores/history?scope=${data.scope}`)} class="text-teal-800 underline" aria-current={!data.childId ? 'page' : undefined}>All children</a>
      {#each data.children as child (child.id)}
        <a href={resolve(`/chores/history?scope=${data.scope}&page=1&child=${encodeURIComponent(child.id)}`)} class="text-teal-800 underline" aria-current={data.childId === child.id ? 'page' : undefined}>{child.name}</a>
      {/each}
    </nav>
  {/if}
  <nav aria-label="Chore status" class="mt-4 flex flex-wrap gap-x-4 gap-y-2">
    {#each scopes as scope (scope)}
      <a href={resolve(`/chores/history?scope=${scope}${data.childId ? `&child=${encodeURIComponent(data.childId)}` : ''}`)} class="text-teal-800 underline" aria-current={data.scope === scope ? 'page' : undefined}>{labels[scope]} ({data.counts[scope]})</a>
    {/each}
  </nav>
  <p class="mt-5 text-sm">Showing {data.items.length} of {data.total} in this view.</p>
  {#if data.pageCount > 1}
    <nav aria-label="Chore history pages" class="mt-3 flex flex-wrap items-center gap-4">
      {#if data.page > 1}<a href={resolve(`/chores/history?scope=${data.scope}&page=${data.page - 1}${data.childId ? `&child=${encodeURIComponent(data.childId)}` : ''}`)} class="text-teal-800 underline">Previous page</a>{/if}
      <span>Page {data.page} of {data.pageCount}</span>
      {#if data.page < data.pageCount}<a href={resolve(`/chores/history?scope=${data.scope}&page=${data.page + 1}${data.childId ? `&child=${encodeURIComponent(data.childId)}` : ''}`)} class="text-teal-800 underline">Next page</a>{/if}
    </nav>
  {/if}
  <section aria-label={labels[data.scope]} class="mt-4 grid gap-4">
    {#each data.items as chore (chore.id)}
      <article class="rounded-2xl bg-white p-5 shadow-sm">
        <h2 class="text-lg font-bold">{chore.title}</h2>
        {#if chore.description}<p class="mt-1">{chore.description}</p>{/if}
        <p class="mt-2 text-sm">{data.role === 'parent' ? `${chore.childName} · ` : ''}Due <time datetime={chore.dueDate}>{chore.dueDate}</time> · {money(chore.rewardCents)}</p>
        {#if chore.status === 'todo'}<p class="mt-3 font-semibold">{chore.dueDate < data.today ? 'Overdue' : 'To do'}</p>
        {:else if chore.status === 'pending_verification'}<p class="mt-3 font-semibold">Waiting for parent verification</p>
        {:else if chore.status === 'needs_rework'}<p class="mt-3 font-semibold">Needs rework</p>{#if chore.reworkReason}<p>{chore.reworkReason}</p>{/if}
        {:else}<p class="mt-3 font-semibold">{chore.rewardCents ? `Approved! You earned ${money(chore.rewardCents)}!` : 'Approved! Great work!'}</p>{/if}
        {#if data.role === 'parent' && chore.status === 'pending_verification'}
          <form method="POST" action={transitionAction} class="mt-4 grid gap-3" aria-label={`Review ${chore.title}`}>
            <input type="hidden" name="id" value={chore.id} />
            <label>Rework reason<input name="reason" maxlength="1000" class="mt-1 w-full rounded-lg border p-3" /></label>
            <div class="flex flex-wrap gap-3"><button name="action" value="verify" class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Verify</button><button name="action" value="rework" class="rounded-xl border border-teal-700 px-4 py-3">Needs rework</button></div>
          </form>
        {:else if data.role === 'kid' && canSubmit(chore)}
          <form method="POST" action={transitionAction} class="mt-4">
            <input type="hidden" name="id" value={chore.id} />
            <button name="action" value="submit" class="min-h-12 rounded-xl bg-teal-700 px-5 py-3 font-bold text-white">Mark complete</button>
          </form>
        {/if}
      </article>
    {:else}
      <p class="rounded-2xl bg-white p-5">No chores in this view.</p>
    {/each}
  </section>
  {#if data.pageCount > 1}
    <nav aria-label="Chore history pages" class="mt-6 flex flex-wrap items-center gap-4">
      {#if data.page > 1}<a href={resolve(`/chores/history?scope=${data.scope}&page=${data.page - 1}${data.childId ? `&child=${encodeURIComponent(data.childId)}` : ''}`)} class="text-teal-800 underline">Previous page</a>{/if}
      <span>Page {data.page} of {data.pageCount}</span>
      {#if data.page < data.pageCount}<a href={resolve(`/chores/history?scope=${data.scope}&page=${data.page + 1}${data.childId ? `&child=${encodeURIComponent(data.childId)}` : ''}`)} class="text-teal-800 underline">Next page</a>{/if}
    </nav>
  {/if}
</main>
