<script lang="ts">
  import { resolve } from '$app/paths';
  import { addCalendarDays } from '../../../lib/calendar/dates';
  import Disclosure from '../../calendar/Disclosure.svelte';
  import type { PageData } from './$types';

  type CreateError = { title: string; description: string; assignee: string; dueDate: string; reward: string };
  type FormResult = { message: string; createError?: CreateError };
  let { data, form }: { data: PageData; form: FormResult | null } = $props();
  let createError = $derived(form?.createError);
  let createDescription = $derived(createError?.description ?? '');
  const statusOrder = ['all', 'todo', 'pending_verification', 'needs_rework', 'verified'] as const;
  const statusLabels = {
    all: 'All statuses',
    todo: 'To do',
    pending_verification: 'Waiting for review',
    needs_rework: 'Needs rework',
    verified: 'Verified'
  } as const;
  const money = (cents: number | null) => cents ? `$${(cents / 100).toFixed(2)}` : 'No reward';
  let totalInWeek = $derived(Object.values(data.counts).reduce((total, count) => total + count, 0));

  function weekQuery(changes: { week?: string; child?: string; status?: string; date?: string; add?: boolean } = {}) {
    const params = [`week=${encodeURIComponent(changes.week ?? data.start)}`];
    const child = changes.child ?? data.childId;
    const status = changes.status ?? data.status;
    if (child) params.push(`child=${encodeURIComponent(child)}`);
    if (status && status !== 'all') params.push(`status=${encodeURIComponent(status)}`);
    if (changes.date) params.push(`date=${encodeURIComponent(changes.date)}`);
    if (changes.add) params.push('add=1');
    return `${params.join('&')}${changes.add ? '#add-chore' : ''}`;
  }

  function historyScope(chore: PageData['days'][number]['children'][number]['chores'][number]) {
    if (chore.status === 'pending_verification') return 'review';
    if (chore.status === 'needs_rework') return 'rework';
    if (chore.status === 'verified') return 'verified';
    if (chore.dueDate < data.today) return 'overdue';
    if (chore.dueDate === data.today) return 'today';
    return chore.dueDate <= addCalendarDays(data.today, 7) ? 'upcoming' : 'later';
  }

  const statusText = (chore: PageData['days'][number]['children'][number]['chores'][number]) => {
    if (chore.status === 'todo') return chore.dueDate < data.today ? 'Overdue' : 'To do';
    if (chore.status === 'pending_verification') return 'Waiting for parent verification';
    if (chore.status === 'needs_rework') return 'Needs rework';
    return 'Verified';
  };
</script>
<svelte:head><title>Chore week · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-4xl px-5 py-8">
  <a href={resolve('/dashboard')} class="text-teal-700">Back to My Day</a>
  <nav aria-label="Chore management" class="mt-3 flex flex-wrap gap-x-4 gap-y-2">
    <a href={resolve('/verify')} class="text-teal-700">Review chores</a>
    <a href={resolve('/chores/history?scope=verified')} class="text-teal-700">Chore history</a>
    <a href={resolve('/chores/series')} class="text-teal-700">Recurring schedules</a>
  </nav>
  <h1 class="mt-6 text-3xl font-bold">Chore week</h1>
  <p class="mt-2">See every child’s chores for one week, then add a one-time chore where it belongs.</p>

  <nav aria-label="Chore week" class="mt-4 flex flex-wrap items-center gap-2">
    <a href={resolve(`/chores/week?${weekQuery({ week: data.previousWeek })}`)} class="rounded-xl border border-teal-700 px-4 py-3">Previous week</a>
    <a href={resolve(`/chores/week?${weekQuery({ week: data.currentWeek })}`)} class="rounded-xl border border-teal-700 px-4 py-3">This week</a>
    <a href={resolve(`/chores/week?${weekQuery({ week: data.nextWeek })}`)} class="rounded-xl border border-teal-700 px-4 py-3">Next week</a>
  </nav>
  <p class="mt-3 text-lg font-semibold" aria-live="polite">{data.weekLabel}</p>
  <form method="GET" action={resolve('/chores/week')} class="mt-4 flex flex-wrap items-end gap-3" aria-label="Jump to a chore week">
    <label>Jump to a date<input name="date" type="date" required defaultValue={data.focusDate} class="mt-1 block rounded-lg border p-3" /></label>
    <button class="rounded-xl border border-teal-700 px-4 py-3">Show week</button>
  </form>

  {#if data.notice === 'created'}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4">Chore added. It appears on its scheduled day below.</p>{/if}
  {#if form?.message}<p role="alert" class="mt-4 rounded-xl bg-rose-50 p-4">{form.message}</p>{/if}

  <nav aria-label="Filter by child" class="mt-5 flex flex-wrap gap-x-4 gap-y-2">
    <a href={resolve(`/chores/week?${weekQuery({ child: '' })}`)} class="text-teal-800 underline" aria-current={!data.childId ? 'page' : undefined}>All children ({totalInWeek})</a>
    {#each data.children as child (child.id)}
      <a href={resolve(`/chores/week?${weekQuery({ child: child.id })}`)} class="text-teal-800 underline" aria-current={data.childId === child.id ? 'page' : undefined}>{child.name} ({child.total})</a>
    {/each}
  </nav>
  <nav aria-label="Filter by chore status" class="mt-3 flex flex-wrap gap-x-4 gap-y-2">
    {#each statusOrder as status (status)}
      <a href={resolve(`/chores/week?${weekQuery({ status })}`)} class="text-teal-800 underline" aria-current={data.status === status ? 'page' : undefined}>{statusLabels[status]} ({status === 'all' ? totalInWeek : data.counts[status]})</a>
    {/each}
  </nav>

  {#if data.truncated}
    <p class="mt-4 rounded-xl bg-amber-50 p-4">This week has more than 500 chores, so this view shows the first 500. Use a filter to narrow it.</p>
  {/if}

  <div id="add-chore">
    <Disclosure class="mt-6 rounded-2xl bg-white p-5 shadow-sm" expanded={data.addOpen || !!createError}>
      <summary class="cursor-pointer text-xl font-bold">Add a chore for this week</summary>
      {#if data.children.length}
        <p class="mt-3 text-sm">This creates one one-time chore. It starts as To do and earns nothing until a parent verifies completed work.</p>
        <form method="POST" action={`?/create&week=${encodeURIComponent(data.start)}&date=${encodeURIComponent(data.focusDate)}${data.childId ? `&child=${encodeURIComponent(data.childId)}` : ''}${data.status !== 'all' ? `&status=${encodeURIComponent(data.status)}` : ''}`} aria-label="Add a chore for this week" class="mt-4 grid gap-3">
          <label>Chore title<input name="title" required maxlength="120" defaultValue={createError?.title ?? ''} class="mt-1 w-full rounded-lg border p-3" /></label>
          <label>Description (optional)<textarea name="description" maxlength="1000" bind:value={createDescription} class="mt-1 w-full rounded-lg border p-3"></textarea></label>
          <label>Assigned child<select name="assignee" class="mt-1 w-full rounded-lg border p-3">{#each data.children as child (child.id)}<option value={child.id} selected={child.id === (createError?.assignee ?? data.children[0].id)}>{child.name}</option>{/each}</select></label>
          <label>Due date<input name="dueDate" type="date" required defaultValue={createError?.dueDate ?? data.focusDate} class="mt-1 w-full rounded-lg border p-3" /></label>
          <label>Reward in dollars<input name="reward" type="number" min="0" max="1000000" step="0.01" defaultValue={createError?.reward ?? ''} class="mt-1 w-full rounded-lg border p-3" /></label>
          <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Add chore</button>
        </form>
      {:else}
        <p class="mt-3">Add a child account before assigning a chore.</p>
      {/if}
    </Disclosure>
  </div>

  {#if data.total === 0}
    <section aria-label="Empty chore week" class="mt-6 rounded-2xl bg-white p-5 shadow-sm">
      {#if totalInWeek === 0}
        <h2 class="text-xl font-bold">No chores planned for this week</h2>
        <p class="mt-2">Give everyone a clear start by adding the first chore to a day.</p>
        <a href={resolve(`/chores/week?${weekQuery({ add: true })}`)} class="mt-3 inline-block rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Add the first chore</a>
      {:else}
        <h2 class="text-xl font-bold">No chores match these filters</h2>
        <p class="mt-2">There are {totalInWeek} {totalInWeek === 1 ? 'chore' : 'chores'} in this week.</p>
        <a href={resolve(`/chores/week?${weekQuery({ child: '', status: 'all' })}`)} class="mt-3 inline-block py-2 font-semibold text-teal-700 underline">Show all chores this week</a>
      {/if}
    </section>
  {:else}
    <section aria-label="Chores by day" class="mt-6">
      {#each data.days as day (day.date)}
        <section aria-label={`Chores for ${day.date}`} class="mt-5 rounded-2xl bg-white p-5 shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-2xl font-bold">{day.label}</h2>
            {#if day.isToday}<span class="rounded-full bg-teal-50 px-3 py-1 text-sm font-bold text-teal-900">Today</span>{/if}
          </div>
          <p class="text-sm text-slate-700">{day.date}</p>
          <a href={resolve(`/chores/week?${weekQuery({ date: day.date, add: true })}`)} class="mt-2 inline-block py-2 text-teal-700 underline">Add a chore for {day.date}</a>
          {#if day.children.length}
            {#each day.children as child (child.id)}
              <div class="mt-4 border-t border-slate-200 pt-3">
                <h3 class="text-lg font-bold">{child.name}</h3>
                <ul class="mt-2 grid gap-3">
                  {#each child.chores as chore (chore.id)}
                    <li>
                      <article aria-label={`${chore.title} for ${chore.childName}`} class="rounded-xl border border-slate-200 p-4">
                        <h4 class="text-lg font-bold">{chore.title}</h4>
                        {#if chore.description}<p class="mt-1">{chore.description}</p>{/if}
                        <p class="mt-2 text-sm">{chore.childName} · Due <time datetime={chore.dueDate}>{chore.dueDate}</time> · <strong>{money(chore.rewardCents)}</strong></p>
                        <p class="mt-2 text-sm font-semibold">{chore.isRecurring ? 'Repeating chore' : 'One-time chore'}</p>
                        <p class="mt-2 font-semibold">{statusText(chore)}</p>
                        {#if chore.status === 'needs_rework' && chore.reworkReason}<p class="mt-1">{chore.reworkReason}</p>{/if}
                        <div class="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
                          {#if chore.status === 'pending_verification'}<a href={resolve('/verify')} class="font-semibold text-teal-700 underline">Review this chore</a>{/if}
                          {#if chore.isRecurring}<a href={resolve('/chores/series')} class="font-semibold text-teal-700 underline">Manage repeating schedule</a>{/if}
                          <a href={resolve(`/chores/history?scope=${historyScope(chore)}&child=${encodeURIComponent(chore.assigneeId)}`)} class="text-teal-700 underline">View in history</a>
                        </div>
                      </article>
                    </li>
                  {/each}
                </ul>
              </div>
            {/each}
          {:else}
            <p class="mt-3 text-slate-700">No chores assigned for this day.</p>
          {/if}
        </section>
      {/each}
    </section>
  {/if}
</main>
