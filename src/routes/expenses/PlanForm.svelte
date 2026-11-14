<script lang="ts">
  let { action, label, initial, id = '', fixedCadence = false, fixedDate = false }: {
    action: string; label: string; id?: string; fixedCadence?: boolean; fixedDate?: boolean;
    initial: { title?: string; amount?: string; dueDate: string; cadence?: string; payee?: string | null; category?: string | null; notes?: string | null };
  } = $props();
  let notes = $derived(initial.notes ?? '');
  const field = 'mt-1 block w-full rounded-lg border border-stone-400 bg-white p-3';
</script>

<form method="POST" {action} aria-label={label} class="mt-3 grid gap-3 sm:grid-cols-2">
  <input type="hidden" name="id" value={id} />
  <label>Title<input name="title" required maxlength="120" defaultValue={initial.title ?? ''} class={field} /></label>
  <label>Planned amount ($)<input name="amount" inputmode="decimal" required maxlength="12" defaultValue={initial.amount ?? ''} class={field} /></label>
  {#if fixedDate}
    <input type="hidden" name="dueDate" value={initial.dueDate} />
    <p>Scheduled from <time datetime={initial.dueDate}>{initial.dueDate}</time></p>
  {:else}
    <label>Due date<input name="dueDate" type="date" required defaultValue={initial.dueDate} class={field} /></label>
  {/if}
  {#if fixedCadence}
    <input type="hidden" name="cadence" value={initial.cadence} />
  {:else}
    <label>Frequency
      <select name="cadence" class={field}>
        <option value="once" selected={(initial.cadence ?? 'once') === 'once'}>One-off</option>
        <option value="weekly" selected={initial.cadence === 'weekly'}>Weekly</option>
        <option value="biweekly" selected={initial.cadence === 'biweekly'}>Every two weeks</option>
        <option value="monthly" selected={initial.cadence === 'monthly'}>Monthly</option>
        <option value="yearly" selected={initial.cadence === 'yearly'}>Yearly</option>
      </select>
    </label>
  {/if}
  <label>Payee<input name="payee" maxlength="120" defaultValue={initial.payee ?? ''} class={field} /></label>
  <label>Category<input name="category" maxlength="120" defaultValue={initial.category ?? ''} class={field} /></label>
  <label class="sm:col-span-2">Notes<textarea name="notes" maxlength="1000" rows="2" bind:value={notes} class={field}></textarea></label>
  <button class="rounded-xl bg-teal-800 px-4 py-3 font-semibold text-white sm:justify-self-start">Save expense</button>
</form>
