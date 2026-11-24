<script lang="ts">
  import { resolve } from '$app/paths';
  import { viewHeading } from '../../lib/calendar/navigation';
  import { addCalendarDays } from '../../lib/calendar/dates';
  import { eventTimeLabel, groupByDate, sortOccurrences } from '../../lib/calendar/presentation';
  import type { PageData } from './$types';
  type FormResult = { message: string };
  type Chore = PageData['sections']['today']['items'][number];
  let { data, form }: { data: PageData; form: FormResult | null } = $props();
  let child = $derived(data.balances[0]);
  let hasChores = $derived(Object.values(data.counts).some(count => count > 0));
  let upcoming = $derived(sortOccurrences(data.upcomingEvents));
  let visibleUpcoming = $derived(upcoming.slice(0, 5));
  let hiddenUpcoming = $derived(upcoming.length - visibleUpcoming.length);
  let upcomingGroups = $derived(groupByDate(data.today, addCalendarDays(data.today, 6), visibleUpcoming).filter(group => group.events.length));
  let firstHiddenDate = $derived(upcoming[5]?.date ?? data.today);
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const todayLabel = () => new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${data.today}T00:00:00.000Z`));
</script>
<svelte:head><title>{data.name}'s day · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-3xl px-4 py-6 text-stone-900 sm:px-6">
  <nav aria-label="My areas" class="flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold">
    <a href={resolve('/calendar')} class="py-2 text-teal-800 underline">Family calendar</a>
    <a href={resolve('/lists')} class="py-2 text-teal-800 underline">Family lists</a>
    <a href={resolve('/meals')} class="py-2 text-teal-800 underline">Meals</a>
    <a href={resolve('/groceries')} class="py-2 text-teal-800 underline">Groceries</a>
    <a href={resolve('/chores/history?scope=verified')} class="py-2 text-teal-800 underline">My chore history</a>
  </nav>
  <header class="mt-4 rounded-3xl bg-teal-800 p-6 text-white shadow-sm">
    <p class="text-sm font-semibold uppercase tracking-widest text-teal-100">Your day</p>
    <h1 class="mt-1 text-3xl font-bold sm:text-4xl">{data.name}'s My Day</h1>
    <p class="mt-2 text-teal-50">{todayLabel()}</p>
    <p class="mt-3 text-teal-50">Here is what needs you today. Take it one step at a time.</p>
  </header>
  {#if form?.message}<p role="status" class="mt-4 rounded-2xl bg-teal-50 p-4 text-teal-900">{form.message}</p>{/if}

  <section aria-labelledby="family-dinners-heading" class="mt-6 rounded-3xl bg-white p-5 shadow-sm">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="family-dinners-heading" class="text-2xl font-bold">Family dinners</h2>
      <a href={resolve(`/meals?date=${data.today}`)} class="font-semibold text-teal-800 underline">See the full week</a>
    </div>
    <p class="mt-2 text-sm text-stone-600">Only dinners your family chose to share.</p>
    {#each data.dinnerDays as day (day.date)}
      <div class="mt-4 border-t border-stone-200 pt-3 first:border-0 first:pt-0">
        <h3 class="font-semibold">{day.label} · {day.date}{#if day.isToday} · Today{/if}</h3>
        {#if day.meals.length}
          <ul class="mt-1 space-y-1">{#each day.meals as meal (meal.id)}<li>{meal.title}{#if meal.time} · {meal.time}{/if}</li>{/each}</ul>
        {:else}
          <p class="mt-1 text-stone-600">No shared dinner planned.</p>
        {/if}
      </div>
    {/each}
  </section>

  <section aria-labelledby="todo-today-heading" class="mt-6 rounded-3xl bg-white p-5 shadow-sm">
    <h2 id="todo-today-heading" class="text-2xl font-bold">To do today</h2>
    {#if !hasChores}
      <p class="mt-3 text-lg">No chores yet. Enjoy your day!</p>
    {:else if !data.sections.today.items.length}
      <p class="mt-3">Nothing is due today. Check the other sections below if you want to get ahead.</p>
    {:else}
      <p class="mt-2 text-stone-600">Pick one thing and mark it complete when you are done.</p>
      {#each data.sections.today.items as chore (chore.id)}
        {@render choreCard(chore, true)}
      {/each}
      {#if data.sections.today.total > data.sections.today.items.length}
        <a href={resolve('/chores/history?scope=today')} class="mt-4 inline-block py-2 font-semibold text-teal-800 underline">See all chores due today ({data.sections.today.total})</a>
      {/if}
    {/if}
  </section>

  {#if child}
    <article aria-label={`Earnings for ${data.name}`} class="mt-6 rounded-3xl bg-amber-50 p-5 shadow-sm">
      <h2 class="text-2xl font-bold">My earnings</h2>
      <p class="mt-3 text-lg">Waiting for verification: {money(child.pendingCents)}</p>
      <p class="text-lg">Verified earnings owed: {money(child.owed)}</p>
      <p class="text-lg">Paid so far: {money(child.paid)}</p>
      <p class="text-lg">Total verified earnings: {money(child.earned)}</p>
      <p class="mt-2 text-sm">Pending money is not earned until a parent checks your work.</p>
      <p class="mt-3"><a href={resolve('/earnings/[childId]', { childId: child.id })} class="font-semibold text-teal-800 underline">See my payment history</a></p>
    </article>
  {/if}

  <section aria-labelledby="rework-heading" class="mt-6 rounded-3xl bg-white p-5 shadow-sm">
    <h2 id="rework-heading" class="text-2xl font-bold">Needs rework</h2>
    {#if data.sections.rework.items.length}
      <p class="mt-2 text-stone-600">A parent left a note. Finish the work, then mark it complete again.</p>
      {#each data.sections.rework.items as chore (chore.id)}
        {@render choreCard(chore, true)}
      {/each}
      {#if data.sections.rework.total > data.sections.rework.items.length}
        <a href={resolve('/chores/history?scope=rework')} class="mt-4 inline-block py-2 font-semibold text-teal-800 underline">See all work needing another try ({data.sections.rework.total})</a>
      {/if}
    {:else}
      <p class="mt-2">Nothing needs another try right now.</p>
    {/if}
  </section>

  <section aria-labelledby="overdue-heading" class="mt-6 rounded-3xl bg-white p-5 shadow-sm">
    <h2 id="overdue-heading" class="text-2xl font-bold">Overdue</h2>
    {#if data.sections.overdue.items.length}
      <p class="mt-2 text-stone-600">These are past their due date. Do what you can, then mark them complete.</p>
      {#each data.sections.overdue.items as chore (chore.id)}
        {@render choreCard(chore, true)}
      {/each}
      {#if data.sections.overdue.total > data.sections.overdue.items.length}
        <a href={resolve('/chores/history?scope=overdue')} class="mt-4 inline-block py-2 font-semibold text-teal-800 underline">See all overdue chores ({data.sections.overdue.total})</a>
      {/if}
    {:else}
      <p class="mt-2">Nothing is overdue. Nice work staying on top of it.</p>
    {/if}
  </section>

  <section aria-labelledby="approval-heading" class="mt-6 rounded-3xl bg-white p-5 shadow-sm">
    <h2 id="approval-heading" class="text-2xl font-bold">Awaiting approval</h2>
    {#if data.sections.review.items.length}
      <p class="mt-2 text-stone-600">You finished these. A parent will check them soon. Nice work!</p>
      {#each data.sections.review.items as chore (chore.id)}
        {@render choreCard(chore, false)}
      {/each}
      {#if data.sections.review.total > data.sections.review.items.length}
        <a href={resolve('/chores/history?scope=review')} class="mt-4 inline-block py-2 font-semibold text-teal-800 underline">See all work waiting for a parent ({data.sections.review.total})</a>
      {/if}
    {:else}
      <p class="mt-2">Nothing is waiting for a parent right now.</p>
    {/if}
  </section>

  <section aria-labelledby="upcoming-chores-heading" class="mt-6 rounded-3xl bg-white p-5 shadow-sm">
    <h2 id="upcoming-chores-heading" class="text-2xl font-bold">Coming up soon</h2>
    {#if data.sections.upcoming.items.length}
      <p class="mt-2 text-stone-600">These are due in the next few days. You do not need to do them today.</p>
      {#each data.sections.upcoming.items as chore (chore.id)}
        {@render choreCard(chore, false)}
      {/each}
      {#if data.sections.upcoming.total > data.sections.upcoming.items.length}
        <a href={resolve('/chores/history?scope=upcoming')} class="mt-4 inline-block py-2 font-semibold text-teal-800 underline">See all upcoming chores ({data.sections.upcoming.total})</a>
      {/if}
    {:else}
      <p class="mt-2">Nothing is coming up in the next few days.</p>
    {/if}
  </section>

  {#if data.sections.later.total}
    <section aria-labelledby="later-heading" class="mt-6 rounded-3xl bg-white p-5 shadow-sm">
      <h2 id="later-heading" class="text-2xl font-bold">Later</h2>
      <p class="mt-2 text-stone-600">These are farther away. You can see them now so nothing surprises you.</p>
      {#each data.sections.later.items as chore (chore.id)}
        {@render choreCard(chore, false)}
      {/each}
      {#if data.sections.later.total > data.sections.later.items.length}
        <a href={resolve('/chores/history?scope=later')} class="mt-4 inline-block py-2 font-semibold text-teal-800 underline">See all later chores ({data.sections.later.total})</a>
      {/if}
    </section>
  {/if}

  <section aria-labelledby="completed-heading" class="mt-6 rounded-3xl bg-white p-5 shadow-sm">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="completed-heading" class="text-2xl font-bold">Recently completed</h2>
      <a href={resolve('/chores/history?scope=verified')} class="font-semibold text-teal-800 underline">My history</a>
    </div>
    {#if data.sections.verified.items.length}
      {#each data.sections.verified.items as chore (chore.id)}
        {@render choreCard(chore, false)}
      {/each}
    {:else}
      <p class="mt-2">Finished chores will show up here after a parent approves them.</p>
    {/if}
  </section>

  <section aria-labelledby="family-plans-heading" class="mt-6 rounded-3xl bg-white p-5 shadow-sm">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="family-plans-heading" class="text-2xl font-bold">Coming up</h2>
      <a href={resolve(`/calendar?date=${data.today}&view=week`)} class="font-semibold text-teal-800 underline">View calendar</a>
    </div>
    {#if !data.upcomingEvents.length}
      <p class="mt-2">Nothing coming up in the next seven days.</p>
    {:else}
      {#each upcomingGroups as group (group.date)}
        <div class="mt-4">
          <h3 class="font-semibold">{viewHeading(group.date, 'day')}</h3>
          <ul class="mt-1 space-y-1">
            {#each group.events as event (event.id)}
              <li><a href={resolve(`/calendar?date=${group.date}&view=day`)} class="text-teal-800 underline"><span class="font-semibold">{eventTimeLabel(event)}</span> {event.title}</a></li>
            {/each}
          </ul>
        </div>
      {/each}
      {#if hiddenUpcoming > 0}<p class="mt-3 text-sm"><a href={resolve(`/calendar?date=${firstHiddenDate}&view=day`)} class="font-semibold text-teal-800 underline">+{hiddenUpcoming} more</a></p>{/if}
    {/if}
  </section>

  <p class="mt-8"><a href={resolve('/settings/sessions')} class="text-teal-800 underline">Signed-in devices</a></p>
  <form method="POST" action={resolve('/sign-out')}><button class="mt-3 rounded-2xl border border-teal-700 px-5 py-3 font-semibold text-teal-800">Sign out</button></form>
</main>

{#snippet choreCard(chore: Chore, allowAction: boolean)}
  <article class="mt-4 rounded-2xl border border-stone-200 bg-stone-50 p-4" aria-label={`Chore: ${chore.title}`}>
    <h3 class="text-xl font-bold">{chore.title}</h3>
    {#if chore.description}<p class="mt-1 text-stone-700">{chore.description}</p>{/if}
    <p class="mt-2 text-sm text-stone-600">Due {chore.dueDate}{chore.rewardCents ? ` · ${money(chore.rewardCents)} reward` : ''}</p>
    {#if chore.status === 'todo'}
      <p class="mt-2 font-semibold">{chore.dueDate < data.today ? 'Overdue' : 'To do'}</p>
    {:else if chore.status === 'pending_verification'}
      <p class="mt-2 font-semibold">Waiting for parent verification</p>
    {:else if chore.status === 'needs_rework'}
      <p class="mt-2 font-semibold">Needs rework</p>
      {#if chore.reworkReason}<p class="mt-1 rounded-lg bg-amber-50 p-2">{chore.reworkReason}</p>{/if}
    {:else}
      <p class="mt-2 font-semibold">{chore.rewardCents ? `Approved! You earned ${money(chore.rewardCents)}!` : 'Approved! Great work!'}</p>
    {/if}
    {#if allowAction && (chore.status === 'todo' || chore.status === 'needs_rework')}
      <form method="POST" action="?/transition" class="mt-3">
        <input type="hidden" name="id" value={chore.id} />
        <button name="action" value="submit" class="min-h-14 w-full rounded-2xl bg-teal-800 px-6 py-4 text-lg font-bold text-white sm:w-auto">Mark complete</button>
      </form>
    {:else if chore.status === 'todo'}
      <p class="mt-2 text-sm text-stone-600">You do not need to do this today.</p>
    {/if}
  </article>
{/snippet}
