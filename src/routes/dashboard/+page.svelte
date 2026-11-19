<script lang="ts">
  import { recipeAttribution } from '../../lib/meals/recipe-link';
  import RecipeCredit from '../../lib/meals/RecipeCredit.svelte';
  import RecipeDetails from '../../lib/meals/RecipeDetails.svelte';
  import { resolve } from '$app/paths';
  import Disclosure from '../calendar/Disclosure.svelte';
  import { viewHeading } from '../../lib/calendar/navigation';
  import { addCalendarDays } from '../../lib/calendar/dates';
  import { eventTimeLabel, groupByDate, sortOccurrences } from '../../lib/calendar/presentation';
  import type { PageData } from './$types';
  type PayoutError = { child: string; amount: string; date: string; note: string; requestId: string };
  type FormResult = { message: string; createError?: { title: string; description: string; assignee: string; dueDate: string; reward: string }; correctionError?: { id: string; reason: string }; payoutError?: PayoutError };
  let { data, form }: { data: PageData; form: FormResult | null } = $props();
  let createError = $derived(form?.createError);
  let createTitle = $derived(createError?.title ?? '');
  let createDescription = $derived(createError?.description ?? '');
  let createDueDate = $derived(createError?.dueDate ?? '');
  let createReward = $derived(createError?.reward ? Number(createError.reward) : undefined);
  let paydayAnchor = $derived(data.payday?.anchor ?? data.today);
  let householdTimezone = $derived(data.timezone);
  const upcomingPreviewLimit = 5;
  let upcoming = $derived(sortOccurrences(data.upcomingEvents));
  let visibleUpcoming = $derived(upcoming.slice(0, upcomingPreviewLimit));
  let hiddenUpcoming = $derived(upcoming.length - visibleUpcoming.length);
  let upcomingGroups = $derived(groupByDate(data.today, addCalendarDays(data.today, 6), visibleUpcoming).filter(group => group.events.length));
  let firstHiddenDate = $derived(upcoming[upcomingPreviewLimit]?.date ?? data.today);
  let balances = $derived.by(() => {
    let values = $state(data.balances.map(balance => {
      const rejected = form?.payoutError?.child === balance.id ? form.payoutError : undefined;
      return { ...balance, payouts: balance.payouts.map(payment => ({ ...payment, correctionInput: form?.correctionError?.id === payment.id ? form.correctionError.reason : '' })), paymentAmount: rejected ? Number(rejected.amount) : balance.paymentAmount, paymentDate: rejected?.date ?? balance.paymentDate, paymentNote: rejected?.note ?? '', requestId: rejected?.requestId ?? balance.requestId };
    }));
    return values;
  });
  const attentionScopes = ['review', 'overdue', 'today', 'upcoming', 'later', 'rework'] as const;
  const sectionTitles = { review: 'Waiting for review', overdue: 'Overdue', today: 'Due today', upcoming: 'Coming up', later: 'Later', rework: 'Needs rework', verified: 'Recently completed' } as const;
  const sectionLinks = { review: 'View all waiting for review', overdue: 'View all overdue chores', today: 'View all chores due today', upcoming: 'View all upcoming chores', later: 'View all later chores', rework: 'View all chores needing rework', verified: 'View all completed chores' } as const;
  let attention = $derived(attentionScopes.filter(scope => data.sections[scope].total > 0));
  let hasChores = $derived(attention.length > 0 || data.sections.verified.total > 0);
  let pendingTotal = $derived(data.balances.reduce((total, balance) => total + balance.pendingCount, 0));
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
</script>
<svelte:head><title>My day · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-4xl px-5 py-8">
  <nav aria-label="Household areas" class="flex flex-wrap gap-x-4 gap-y-2">
    <a href={resolve('/display')} class="text-teal-700">Family display</a>
    <a href={resolve('/calendar')} class="text-teal-700">Family calendar</a>
    <a href={resolve('/meals')} class="text-teal-700">Meals</a>
    <a href={resolve('/groceries')} class="text-teal-700">Groceries</a>
    {#if data.role === 'parent'}
      <a href={resolve('/expenses')} class="text-teal-700">Expenses</a>
      <a href={resolve('/chores/series')} class="text-teal-700">Recurring chores{data.activeSeries ? ` (${data.activeSeries})` : ''}</a>
    {/if}
    <a href={resolve('/chores/history?scope=verified')} class="text-teal-700">{data.role === 'parent' ? 'Chore history' : 'My chore history'}</a>
  </nav>
  <h1 class="mt-6 text-3xl font-bold">{data.role === 'parent' ? `Hello, ${data.name}` : `${data.name}'s My Day`}</h1>
  <p class="mt-2">{data.role === 'parent' ? 'Parent dashboard' : 'Your day'}</p>
  {#if data.onboardingPending}
    <section aria-label="Family setup" class="mt-5 rounded-2xl bg-teal-50 p-5">
      <h2 class="text-lg font-bold">Make yourself at home</h2>
      <p class="mt-1">Your setup progress is saved. You can use the dashboard at any time.</p>
      <a class="mt-2 inline-block font-semibold text-teal-800 underline" href={resolve('/onboarding')}>Continue family setup</a>
    </section>
  {:else if data.showWelcome}
    <section aria-label="Welcome home" class="mt-5 rounded-2xl bg-teal-50 p-5">
      <h2 class="text-lg font-bold">Welcome home!</h2>
      <p class="mt-1">Your family’s hub is ready. Use the links above to plan your day, or start with a chore below.</p>
    </section>
  {/if}
  <section aria-labelledby="coming-up-heading" class="mt-6 rounded-2xl bg-white p-5 shadow-sm">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="coming-up-heading" class="text-xl font-bold">Coming up</h2>
      <a href={resolve(`/calendar?date=${data.today}&view=week`)} class="font-semibold text-teal-700 underline">View calendar</a>
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
      {#if hiddenUpcoming > 0}<p class="mt-3 text-sm"><a href={resolve(`/calendar?date=${firstHiddenDate}&view=day`)} class="font-semibold text-teal-700 underline">+{hiddenUpcoming} more</a></p>{/if}
    {/if}
    {#if data.role === 'parent'}<a href={resolve(`/calendar?date=${data.today}&view=day`)} class="mt-3 inline-block py-2 font-semibold text-teal-700">Add an event</a>{/if}
  </section>
  {#if data.role === 'parent'}
    <section aria-label="Tonight's meal" class="mt-6 rounded-2xl bg-white p-5 shadow-sm">
      <h2 class="text-xl font-bold">Tonight's meal</h2>
      {#each data.meals as meal (meal.id)}
        {@const attribution = recipeAttribution(meal.source, meal.recipeUrl)}
        <article class="mt-4"><h3 class="font-bold">{meal.title}</h3>{#if meal.time}<p>{meal.time}</p>{/if}{#if meal.servings}<p>Serves {meal.servings}</p>{/if}<RecipeCredit source={meal.source} recipeUrl={meal.recipeUrl} /><RecipeDetails details={meal.recipeDetails} />{#if meal.ingredients}{#if attribution?.verifiedSource}<p class="mt-2 text-sm font-semibold">Family-entered ingredients</p>{/if}<p class="mt-1 whitespace-pre-line">{meal.ingredients}</p>{/if}</article>
      {:else}<p class="mt-2">No meals planned for today.</p>{/each}
      <a href={resolve('/meals')} class="mt-3 inline-block py-2 text-teal-700">Plan meals</a>
    </section>
  {/if}
  {#if pendingTotal}
    <section aria-label="Review status" class="mt-6 rounded-2xl bg-amber-50 p-5">
      <h2 class="text-xl font-bold">{data.role === 'parent' ? 'Chores waiting for you' : 'Waiting for a parent'}</h2>
      <p class="mt-2"><a href={resolve('/chores/history?scope=review')} class="font-semibold text-teal-800 underline">{pendingTotal} {pendingTotal === 1 ? 'chore is' : 'chores are'} waiting for {data.role === 'parent' ? 'your review' : 'a parent to check'}.</a></p>
    </section>
  {/if}
  {#if form?.message}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4 text-teal-900">{form.message}</p>{/if}
  {#if data.balances.length}
    <section class="mt-6 rounded-2xl bg-amber-50 p-5"><h2 class="text-xl font-bold">Earnings</h2>
      {#if data.payday}<p class="mt-2">Next payday: {data.payday.next}</p>{/if}
      {#each balances as balance (balance.id)}<article aria-label={`Earnings for ${balance.name}`} class="mt-4"><h3 class="font-bold">{balance.name}</h3><p>Waiting for verification: {money(balance.pendingCents)}</p><p>Verified earnings owed: {money(balance.owed)}</p><p>Paid so far: {money(balance.paid)}</p><p>Total verified earnings: {money(balance.earned)}</p>
        {#if data.role === 'parent' && (balance.owed > 0 || form?.payoutError?.child === balance.id)}
          <Disclosure class="mt-3" expanded={form?.payoutError?.child === balance.id}><summary class="cursor-pointer font-semibold">Record a payment</summary><p class="mt-2 text-sm">Record money you have already paid; this does not transfer money.</p>
            <form method="POST" action="?/payout" class="mt-3 grid gap-3"><input type="hidden" name="child" value={balance.id} /><input type="hidden" name="requestId" value={balance.requestId} />
              <label>Payment amount<input name="amount" type="number" min="0.01" max={(balance.owed / 100).toFixed(2)} step="0.01" required defaultValue={balance.paymentAmount} class="mt-1 block w-full rounded-lg border p-3" /></label>
              <label>Payment date<input name="date" type="date" bind:value={balance.paymentDate} required class="mt-1 block w-full rounded-lg border p-3" /></label>
              <label>Payment note<input name="note" maxlength="1000" defaultValue={balance.paymentNote} class="mt-1 block w-full rounded-lg border p-3" /></label>
              <button disabled={balance.owed <= 0} class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white disabled:opacity-50">Record payment</button>
            </form>
          </Disclosure>
        {/if}
        {#if balance.payouts.length}<div class="mt-3"><h4 class="font-semibold">Recent payments</h4>{#each balance.payouts as payment (payment.id)}<div class="mt-2"><p>{payment.paidDate} · {money(payment.amountCents)}{payment.reversalReason ? ' · Corrected' : ''}</p>{#if payment.note}<p>{payment.note}</p>{/if}{#if payment.reversalReason}<p>Correction: {payment.reversalReason}</p>{:else if data.role === 'parent'}<Disclosure expanded={form?.correctionError?.id === payment.id}><summary class="cursor-pointer">Correct this payment</summary><p class="mt-2 text-sm">This reverses the whole record and restores the amount owed; it does not transfer money.</p><form method="POST" action="?/reversePayout" class="mt-2 grid gap-2"><input type="hidden" name="id" value={payment.id} /><label>Correction reason<input name="reason" required maxlength="1000" defaultValue={payment.correctionInput} class="mt-1 block w-full rounded-lg border p-3" /></label><button class="rounded-xl border border-teal-700 px-4 py-3">Record correction</button></form></Disclosure>{/if}</div>{/each}</div>{/if}
        <p class="mt-3"><a href={resolve('/earnings/[childId]', { childId: balance.id })} class="text-teal-800 underline">{balance.payoutCount === 0 ? 'Payment history' : `View all ${balance.payoutCount} payments`}</a></p>
      </article>{/each}
    </section>
  {/if}
  {#if data.role === 'parent'}
    <details class="mt-6 rounded-2xl bg-white p-5 shadow-sm"><summary class="cursor-pointer font-bold">Payday schedule</summary><p class="mt-2 text-sm">A reminder only; no money is transferred automatically.</p><form method="POST" action="?/payday" class="mt-3 grid gap-3"><label>First payday<input name="anchor" type="date" bind:value={paydayAnchor} required class="mt-1 block w-full rounded-lg border p-3" /></label><label>Frequency<select name="cadence" class="mt-1 block w-full rounded-lg border p-3"><option value="7" selected={data.payday?.cadence !== 14}>Weekly</option><option value="14" selected={data.payday?.cadence === 14}>Every two weeks</option></select></label><button class="rounded-xl border border-teal-700 px-4 py-3">Save payday</button></form></details>
    <Disclosure class="mt-6 rounded-2xl bg-white p-5 shadow-sm" expanded={!!createError}><summary class="cursor-pointer text-xl font-bold">Add a chore</summary>
      {#if data.children.length}
        <form method="POST" action="?/create" class="mt-4 grid gap-3">
          <label>Chore title<input name="title" required maxlength="120" defaultValue={createTitle} class="mt-1 w-full rounded-lg border p-3" /></label>
          <label>Description (optional)<textarea name="description" maxlength="1000" bind:value={createDescription} class="mt-1 w-full rounded-lg border p-3"></textarea></label>
          <label>Assigned child<select name="assignee" class="mt-1 w-full rounded-lg border p-3">{#each data.children as child (child.id)}<option value={child.id} selected={child.id === createError?.assignee}>{child.name}</option>{/each}</select></label>
          <label>Due date<input name="dueDate" type="date" required bind:value={createDueDate} class="mt-1 w-full rounded-lg border p-3" /></label>
          <label>Reward in dollars<input name="reward" type="number" min="0" max="1000000" step="0.01" defaultValue={createReward} class="mt-1 w-full rounded-lg border p-3" /></label>
          <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Add chore</button>
        </form>
      {:else}<p class="mt-3">Add a child account before assigning a chore.</p>{/if}
    </Disclosure>
    <details class="mt-6 rounded-2xl bg-white p-5 shadow-sm"><summary class="cursor-pointer font-bold">Household time zone</summary><form method="POST" action="?/timezone" class="mt-3 flex flex-wrap items-end gap-3"><label>Time zone (for example, America/Chicago)<input name="timezone" defaultValue={householdTimezone} required class="mt-1 block rounded-lg border p-3" /></label><button class="rounded-xl border border-teal-700 px-4 py-3">Save time zone</button></form></details>
  {/if}
  <section class="mt-6" aria-labelledby="chores-heading"><h2 id="chores-heading" class="text-xl font-bold">{data.role === 'parent' ? 'Family chores' : 'My chores'}</h2>
    {#if !hasChores}<p class="mt-3 rounded-2xl bg-white p-5">No chores yet. Enjoy your day!</p>{/if}
    {#each attention as scope (scope)}
      <section class="mt-6" aria-labelledby={`${scope}-heading`}>
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id={`${scope}-heading`} class="text-lg font-bold">{sectionTitles[scope]}</h3>
          {#if data.sections[scope].total > data.sections[scope].items.length}<a href={resolve(`/chores/history?scope=${scope}`)} class="text-teal-800 underline">{sectionLinks[scope]} ({data.sections[scope].total})</a>{/if}
        </div>
        {#each data.sections[scope].items as chore (chore.id)}
          <article class="mt-4 rounded-2xl bg-white p-5 shadow-sm">
            <h4 class="text-lg font-bold">{chore.title}</h4>
            {#if chore.description}<p class="mt-1">{chore.description}</p>{/if}
            <p class="mt-2 text-sm">{data.role === 'parent' ? `${chore.childName} · ` : ''}Due {chore.dueDate} {chore.rewardCents ? `· ${money(chore.rewardCents)} reward` : ''}</p>
            {#if chore.status === 'todo'}<p class="mt-3 font-semibold">{chore.dueDate < data.today ? 'Overdue' : 'To do'}</p>
            {:else if chore.status === 'pending_verification'}<p class="mt-3 font-semibold">Waiting for parent verification</p>
            {:else if chore.status === 'needs_rework'}<p class="mt-3 font-semibold">Needs rework</p>{#if chore.reworkReason}<p>{chore.reworkReason}</p>{/if}
            {:else}<p class="mt-3 font-semibold">{chore.rewardCents ? `Approved! You earned ${money(chore.rewardCents)}!` : 'Approved! Great work!'}</p>{/if}
            {#if data.role === 'kid' && chore.scheduledDate && chore.scheduledDate > data.today && chore.status === 'todo'}<p class="mt-3">Coming up</p>
            {:else if data.role === 'kid' && (chore.status === 'todo' || chore.status === 'needs_rework')}
              <form method="POST" action="?/transition" class="mt-4"><input type="hidden" name="id" value={chore.id} /><button name="action" value="submit" class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Mark complete</button></form>
            {:else if data.role === 'parent' && chore.status === 'pending_verification'}
              <form method="POST" action="?/transition" class="mt-4 grid gap-3"><input type="hidden" name="id" value={chore.id} /><label>Rework reason<input name="reason" maxlength="1000" class="mt-1 w-full rounded-lg border p-3" /></label><div class="flex flex-wrap gap-3"><button name="action" value="verify" class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Verify</button><button name="action" value="rework" class="rounded-xl border border-teal-700 px-4 py-3">Needs rework</button></div></form>
            {/if}
          </article>
        {/each}
      </section>
    {/each}
    {#if data.sections.verified.total > 0}
      <section class="mt-6" aria-labelledby="verified-heading">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="verified-heading" class="text-lg font-bold">{sectionTitles.verified}</h3>
          <a href={resolve('/chores/history?scope=verified')} class="text-teal-800 underline">{sectionLinks.verified} ({data.sections.verified.total})</a>
        </div>
        {#each data.sections.verified.items as chore (chore.id)}
          <article class="mt-4 rounded-2xl bg-white p-5 shadow-sm">
            <h4 class="text-lg font-bold">{chore.title}</h4>
            {#if chore.description}<p class="mt-1">{chore.description}</p>{/if}
            <p class="mt-2 text-sm">{data.role === 'parent' ? `${chore.childName} · ` : ''}Due {chore.dueDate} {chore.rewardCents ? `· ${money(chore.rewardCents)} reward` : ''}</p>
            <p class="mt-3 font-semibold">{chore.rewardCents ? `Approved! You earned ${money(chore.rewardCents)}!` : 'Approved! Great work!'}</p>
          </article>
        {/each}
      </section>
    {/if}
  </section>
  <p class="mt-8"><a href={resolve('/settings/sessions')} class="text-teal-700">Signed-in devices</a></p>
  <form method="POST" action={resolve('/sign-out')}><button class="mt-8 rounded-xl border border-teal-700 px-4 py-3 text-teal-700">Sign out</button></form>
</main>
