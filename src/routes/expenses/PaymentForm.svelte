<script lang="ts">
  let { action, id, date, initial }: { action: string; id: string; date: string; initial: { paidDate: string; amount: string; note?: string; requestId: string } } = $props();
  let note = $derived(initial.note ?? '');
  const field = 'mt-1 block w-full rounded-lg border border-stone-400 bg-white p-3';
</script>

<form method="POST" {action} aria-label="Record payment" class="mt-3 grid gap-3 sm:grid-cols-2">
  <input type="hidden" name="id" value={id} />
  <input type="hidden" name="scheduledDate" value={date} />
  <input type="hidden" name="requestId" value={initial.requestId} />
  <label>Actual payment date<input name="paidDate" type="date" required defaultValue={initial.paidDate} class={field} /></label>
  <label>Actual paid amount ($)<input name="amount" inputmode="decimal" required maxlength="12" defaultValue={initial.amount} class={field} /></label>
  <label class="sm:col-span-2">Payment note<textarea name="note" maxlength="1000" rows="2" bind:value={note} class={field}></textarea></label>
  <button class="rounded-xl bg-teal-800 px-4 py-3 font-semibold text-white sm:justify-self-start">Save payment</button>
</form>
