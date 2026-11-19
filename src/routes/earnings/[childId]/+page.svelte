<script lang="ts">
  import { resolve } from '$app/paths';
  import Disclosure from '../../calendar/Disclosure.svelte';
  import type { PageData } from './$types';
  type FormResult = { message: string; correctionError?: { id: string; reason: string } };
  let { data, form }: { data: PageData; form: FormResult | null } = $props();
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
</script>
<svelte:head><title>Payment history · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-4xl px-5 py-8">
  <a href={resolve('/dashboard')} class="text-teal-700">Back to My Day</a>
  <h1 class="mt-6 text-3xl font-bold">{data.child.name}'s payments</h1>
  <p class="mt-2">Verified earnings and recorded payments. Pending chores are not money owed until a parent verifies them.</p>
  {#if data.notice === 'corrected'}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4">Payment correction recorded. The amount owed was restored.</p>{/if}
  {#if form?.message}<p role="alert" class="mt-4 rounded-xl bg-rose-50 p-4">{form.message}</p>{/if}
  <section aria-label="Earnings summary" class="mt-6 rounded-2xl bg-amber-50 p-5">
    <h2 class="text-xl font-bold">Earnings summary</h2>
    <p class="mt-2">Waiting for verification: {money(data.pendingCents)} · {data.pendingCount} {data.pendingCount === 1 ? 'chore' : 'chores'}</p>
    <p>Verified earnings owed: {money(data.balance.owed)}</p>
    <p>Paid so far: {money(data.balance.paid)}</p>
    <p>Total verified earnings: {money(data.balance.earned)}</p>
  </section>
  <p class="mt-5 text-sm">Showing {data.items.length} of {data.total} payments.</p>
  {#if data.pageCount > 1}
    <nav aria-label="Payment history pages" class="mt-3 flex flex-wrap items-center gap-4">
      {#if data.page > 1}<a href={resolve(`/earnings/[childId]?page=${data.page - 1}`, { childId: data.child.id })} class="text-teal-800 underline">Previous page</a>{/if}
      <span>Page {data.page} of {data.pageCount}</span>
      {#if data.page < data.pageCount}<a href={resolve(`/earnings/[childId]?page=${data.page + 1}`, { childId: data.child.id })} class="text-teal-800 underline">Next page</a>{/if}
    </nav>
  {/if}
  <section aria-label="Recorded payments" class="mt-4 grid gap-4">
    {#each data.items as payment (payment.id)}
      {@const rejected = form?.correctionError?.id === payment.id ? form.correctionError : undefined}
      <article class="rounded-2xl bg-white p-5 shadow-sm">
        <h2 class="font-bold"><time datetime={payment.paidDate}>{payment.paidDate}</time> · {money(payment.amountCents)}</h2>
        {#if payment.note}<p class="mt-1">{payment.note}</p>{/if}
        {#if payment.reversalReason}<p class="mt-2 font-semibold">Corrected: {payment.reversalReason}</p>{:else if data.role === 'parent'}
          <Disclosure class="mt-3" expanded={!!rejected}><summary class="cursor-pointer font-semibold">Correct this payment</summary><p class="mt-2 text-sm">This reverses the whole record and restores the amount owed; it does not transfer money.</p>
            <form method="POST" action={'?/reversePayout&page=' + data.page} class="mt-3 grid gap-2"><input type="hidden" name="id" value={payment.id} /><label>Correction reason<input name="reason" required maxlength="1000" defaultValue={rejected?.reason ?? ''} class="mt-1 block w-full rounded-lg border p-3" /></label><button class="rounded-xl border border-teal-700 px-4 py-3">Record correction</button></form>
          </Disclosure>
        {/if}
      </article>
    {:else}
      <p class="rounded-2xl bg-white p-5">No recorded payments yet.</p>
    {/each}
  </section>
  {#if data.pageCount > 1}
    <nav aria-label="Payment history pages" class="mt-6 flex flex-wrap items-center gap-4">
      {#if data.page > 1}<a href={resolve(`/earnings/[childId]?page=${data.page - 1}`, { childId: data.child.id })} class="text-teal-800 underline">Previous page</a>{/if}
      <span>Page {data.page} of {data.pageCount}</span>
      {#if data.page < data.pageCount}<a href={resolve(`/earnings/[childId]?page=${data.page + 1}`, { childId: data.child.id })} class="text-teal-800 underline">Next page</a>{/if}
    </nav>
  {/if}
</main>
