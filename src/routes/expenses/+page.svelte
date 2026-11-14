<script lang="ts">
  import { resolve } from '$app/paths';
  import Disclosure from '../calendar/Disclosure.svelte';
  import PlanForm from './PlanForm.svelte';
  import PaymentForm from './PaymentForm.svelte';
  import ReversalForm from './ReversalForm.svelte';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const dates = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const dollars = (cents: number) => currency.format(cents / 100);
  const displayDate = (date: string) => dates.format(new Date(date + 'T00:00:00Z'));
  const cadence = { once: 'One-off', weekly: 'Weekly', biweekly: 'Every two weeks', monthly: 'Monthly', yearly: 'Yearly' };
  const notices: Record<string, string> = { created: 'Expense added.', updated: 'Expense updated.', paused: 'Recurrence paused.', active: 'Recurrence resumed.', ended: 'Recurrence ended.', skipped: 'Occurrence skipped.', paid: 'Payment recorded.', reversed: 'Payment reversed.' };
  const action = (name: string) => '?/' + name + '&days=' + data.days + '&date=' + data.date;
  const addDraft = $derived(form?.operation === 'save' && !form.id ? form.raw : undefined);
  const panel = 'rounded-2xl border border-stone-200 bg-white p-5 shadow-sm';
  const secondary = 'rounded-xl border border-teal-700 px-4 py-3 font-semibold text-teal-800';
  type Occurrence = PageData['selected'][number];
</script>

<svelte:head><title>Expenses · Fleck Home Hub</title></svelte:head>

{#snippet bill(item: Occurrence)}
  {@const paymentDraft = form?.operation === 'pay' && form.id === item.id && form.scheduledDate === item.date ? form.raw : undefined}
  <article class={panel}>
    <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 class="text-lg font-semibold">{item.title}</h3>
      <p class="text-lg font-semibold tabular-nums">{dollars(item.amountCents)}</p>
    </div>
    <p class="mt-1 text-sm text-stone-700">
      Due <time datetime={item.date}>{displayDate(item.date)}</time>
      · {item.paid ? 'Recorded paid' : item.date < data.today ? 'Overdue' : item.date === data.today ? 'Due today' : 'Upcoming'}
    </p>
    {#if item.payee || item.category}<p class="mt-2">{[item.payee, item.category].filter(Boolean).join(' · ')}</p>{/if}
    {#if item.notes}<p class="mt-2 whitespace-pre-line">{item.notes}</p>{/if}
    {#if !item.paid}
      <Disclosure class="mt-3" expanded={!!paymentDraft}>
        <summary class="cursor-pointer py-2 font-semibold text-teal-800">Record paid</summary>
        <PaymentForm action={action('pay')} id={item.id} date={item.date} initial={paymentDraft ?? { paidDate: data.today, amount: (item.amountCents / 100).toFixed(2), requestId: item.requestId }} />
      </Disclosure>
    {/if}
    {#if item.canSkip}
      <form method="POST" action={action('skip')} class="mt-2" aria-label="Skip scheduled occurrence">
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="scheduledDate" value={item.date} />
        <button class={secondary}>Skip this occurrence</button>
      </form>
    {/if}
  </article>
{/snippet}

<main class="mx-auto max-w-4xl px-4 py-7 text-stone-900 sm:px-6">
  <a href={resolve('/dashboard')} class="inline-block py-2 text-teal-800 underline">Back to home</a>
  <h1 class="mt-3 text-3xl font-bold">Expenses</h1>
  <form method="GET" action={resolve('/expenses')} aria-label="Expense date range" class="mt-4 flex flex-wrap items-end gap-3">
    <label>Start date<input name="date" type="date" required defaultValue={data.date} class="mt-1 block rounded-lg border border-stone-400 bg-white p-3" /></label>
    <label>Range
      <select name="days" class="mt-1 block rounded-lg border border-stone-400 bg-white p-3">
        <option value="30" selected={data.days === 30}>30 days</option>
        <option value="90" selected={data.days === 90}>90 days</option>
      </select>
    </label>
    <button class={secondary}>Show expenses</button>
  </form>
  {#if form?.message}<p role="alert" class="mt-4 rounded-xl bg-rose-50 p-4 text-rose-950">{form.message}</p>{/if}
  {#if data.notice && Object.hasOwn(notices, data.notice)}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4">{notices[data.notice]}</p>{/if}
  <div class="mt-5 grid gap-3 sm:grid-cols-2">
    <div class="rounded-xl bg-amber-50 p-4"><p>Total planned for selected due dates</p><p class="text-2xl font-bold tabular-nums">{dollars(data.plannedTotal)}</p></div>
    <div class="rounded-xl bg-teal-50 p-4"><p>Total recorded paid for selected due dates</p><p class="text-2xl font-bold tabular-nums">{dollars(data.paidTotal)}</p></div>
  </div>

  <Disclosure class={'mt-5 ' + panel} expanded={!!addDraft}>
    <summary class="cursor-pointer text-lg font-semibold text-teal-800">Add expense</summary>
    <PlanForm action={action('save')} label="Add expense" initial={addDraft ?? { dueDate: data.date }} />
  </Disclosure>

  <section aria-labelledby="upcoming" class="mt-7">
    <h2 id="upcoming" class="text-xl font-bold">{data.date < data.today ? 'Scheduled expenses' : 'Upcoming expenses'}</h2>
    <p class="mt-1 text-sm text-stone-700">{displayDate(data.date)} to {displayDate(data.through)}</p>
    <div class="mt-3 grid gap-3">
      {#each data.selected as item (item.id + '/' + item.date)}
        {@render bill(item)}
      {:else}<p>No expenses scheduled in this range.</p>{/each}
    </div>
  </section>

  <section aria-labelledby="overdue" class="mt-7">
    <h2 id="overdue" class="text-xl font-bold">Overdue expenses</h2>
    <p class="mt-1 text-sm text-stone-700">{displayDate(data.overdueFrom)} to {displayDate(data.overdueThrough)}</p>
    <div class="mt-3 grid gap-3">
      {#each data.overdue as item (item.id + '/' + item.date)}
        {@render bill(item)}
      {:else}<p>No unpaid expenses due in this period.</p>{/each}
    </div>
  </section>

  <section aria-labelledby="history" class="mt-7">
    <h2 id="history" class="text-xl font-bold">Payment history</h2>
    <p class="mt-1 text-sm text-stone-700">Payments for due dates in the periods shown above.</p>
    <div class="mt-3 grid gap-3">
      {#each data.history as item (item.id)}
        {@const reversal = form?.operation === 'reverse' && form.id === item.id ? form.raw : undefined}
        <article class={panel}>
          <h3 class="text-lg font-semibold">{item.plannedTitle}</h3>
          <p class="mt-1">{item.reversedAt ? 'Reversed' : 'Recorded paid'} · {dollars(item.amountCents)} on <time datetime={item.paidDate}>{displayDate(item.paidDate)}</time></p>
          <p class="text-sm text-stone-700">Scheduled for <time datetime={item.scheduledDate}>{displayDate(item.scheduledDate)}</time> · Planned {dollars(item.plannedAmountCents)}</p>
          {#if item.note}<p class="mt-2 whitespace-pre-line">{item.note}</p>{/if}
          {#if item.reversedAt}
            <p class="mt-2 whitespace-pre-line">Reason: {item.reversalReason}</p>
            {#if item.canReplace}
              <Disclosure class="mt-3" expanded={form?.operation === 'pay' && form.id === item.expenseId && form.scheduledDate === item.scheduledDate}>
                <summary class="cursor-pointer py-2 font-semibold text-teal-800">Record corrected payment</summary>
                <PaymentForm action={action('pay')} id={item.expenseId} date={item.scheduledDate} initial={form?.operation === 'pay' && form.id === item.expenseId && form.scheduledDate === item.scheduledDate ? form.raw : { paidDate: data.today, amount: (item.plannedAmountCents / 100).toFixed(2), requestId: item.requestId }} />
              </Disclosure>
            {/if}
          {:else}
            <Disclosure class="mt-3" expanded={!!reversal}>
              <summary class="cursor-pointer py-2 font-semibold text-teal-800">Reverse payment</summary>
              <ReversalForm action={action('reverse')} id={item.id} initial={reversal?.reason ?? ''} />
            </Disclosure>
          {/if}
        </article>
      {:else}<p>No recorded payments for these due dates.</p>{/each}
    </div>
  </section>

  <section aria-labelledby="plans" class="mt-7">
    <h2 id="plans" class="text-xl font-bold">Expense plans</h2>
    <div class="mt-3 grid gap-3">
      {#each data.plans as plan (plan.id)}
        {@const draft = form?.operation === 'save' && form.id === plan.id ? form.raw : undefined}
        <article class={panel}>
          <h3 class="text-lg font-semibold">{plan.title}</h3>
          <p class="mt-1">{cadence[plan.cadence]} · {dollars(plan.amountCents)} · {plan.state === 'active' ? 'Active' : plan.state === 'paused' ? 'Paused' : 'Ended'}</p>
          {#if plan.state !== 'ended'}
            <Disclosure class="mt-3" expanded={!!draft}>
              <summary class="cursor-pointer py-2 font-semibold text-teal-800">Edit expense</summary>
              <p class="text-sm text-stone-700">Description and amount changes apply to future due dates.</p>
              <PlanForm action={action('save')} label={'Edit ' + plan.title} id={plan.id} fixedCadence fixedDate={plan.cadence !== 'once' || !!plan.hasPaymentHistory} initial={draft ? { ...draft, dueDate: plan.cadence !== 'once' || plan.hasPaymentHistory ? plan.dueDate : draft.dueDate } : { ...plan, amount: (plan.amountCents / 100).toFixed(2) }} />
            </Disclosure>
            {#if plan.cadence !== 'once'}
              <form method="POST" action={action('state')} aria-label="Change recurrence status" class="mt-2 flex flex-wrap gap-2">
                <input type="hidden" name="id" value={plan.id} />
                <button name="state" value={plan.state === 'paused' ? 'active' : 'paused'} class={secondary}>{plan.state === 'paused' ? 'Resume recurrence' : 'Pause recurrence'}</button>
              </form>
              <Disclosure class="mt-2">
                <summary class="cursor-pointer py-2 font-semibold text-teal-800">End recurrence</summary>
                <form method="POST" action={action('state')} aria-label="End recurring plan" class="mt-2">
                  <input type="hidden" name="id" value={plan.id} />
                  <button name="state" value="ended" class={secondary}>Confirm end</button>
                </form>
              </Disclosure>
            {/if}
          {/if}
        </article>
      {:else}<p>Add an expense to start planning household bills.</p>{/each}
    </div>
  </section>
</main>
