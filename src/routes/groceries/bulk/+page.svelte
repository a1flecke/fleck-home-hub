<script lang="ts">
  import { resolve } from '$app/paths';
  import { MAX_BULK_INPUT_CHARS, MAX_BULK_LINES, type BulkReview, type BulkReviewItem } from '../../../lib/grocery/bulk';

  type BulkForm = {
    message?: string;
    list?: string;
    review?: BulkReview;
  };

  let { form }: { form: BulkForm | null } = $props();
  let list = $derived(form?.list ?? '');

  function amount(item: BulkReviewItem): string {
    return [item.quantity, item.unit].filter(Boolean).join(' ');
  }

  function existingLabel(item: BulkReviewItem): string {
    if (!item.existing) return '';
    const value = [item.existing.quantity, item.existing.unit].filter(Boolean).join(' ');
    return value ? `${item.existing.name} (${value})` : item.existing.name;
  }
</script>
<svelte:head><title>Add several groceries · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-3xl px-5 py-8">
  <a href={resolve('/groceries')} class="text-teal-700">Back to grocery list</a>
  <h1 class="mt-5 text-3xl font-bold">Add several groceries</h1>
  <p class="mt-2">Paste a shopping list, one item per line. You can check and correct every item before anything is added.</p>
  <p class="mt-1 text-sm text-slate-700">Up to {MAX_BULK_LINES} lines. Nothing is saved until you confirm the reviewed list.</p>

  {#if !form?.review}
    <form method="POST" action="?/review" aria-label="Paste a grocery list" class="mt-6 grid gap-3 rounded-2xl bg-white p-5 shadow-sm">
      {#if form?.message}<p role="alert" class="rounded-xl bg-amber-50 p-3">{form.message}</p>{/if}
      <label for="bulk-list" class="font-bold">Paste your list</label>
      <p id="bulk-list-help" class="text-sm text-slate-700">One item per line, for example “2 gallons milk”. Lines that cannot be split confidently stay whole for you to correct.</p>
      <textarea id="bulk-list" name="list" rows="9" required maxlength={MAX_BULK_INPUT_CHARS} bind:value={list} aria-describedby="bulk-list-help" class="mt-1 block w-full rounded-xl border p-4 text-lg"></textarea>
      <button class="rounded-xl bg-teal-700 px-4 py-3 text-lg font-bold text-white">Review list</button>
    </form>
  {:else}
    <section aria-label="Review bulk groceries" class="mt-6 rounded-2xl bg-white p-5 shadow-sm">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-2xl font-bold">Review {form.review.items.length} {form.review.items.length === 1 ? 'item' : 'items'}</h2>
        <p class="rounded-full bg-teal-50 px-3 py-1 text-sm font-bold text-teal-900">{form.review.toAdd} to add · {form.review.toSkip} skipped</p>
      </div>
      {#if form.message}<p role="alert" class="mt-3 rounded-xl bg-amber-50 p-3">{form.message}</p>{/if}
      <p class="mt-2 text-sm">Check each name, quantity and unit. Existing items are never changed or combined automatically.</p>

      <form method="POST" action="?/confirm" aria-label="Add reviewed groceries" class="mt-4 grid gap-4">
        <input type="hidden" name="rowCount" value={form.review.items.length} />
        {#each form.review.items as item, index (item.key)}
          <fieldset class="rounded-xl border p-4" data-key={item.key}>
            <legend class="px-1 font-semibold">Original line: {item.line}</legend>
            {#if item.needsReview}<p class="mt-1 text-sm text-amber-800">This line could not be split confidently. Check the name, quantity and unit before adding it.</p>{/if}
            {#if item.existing}<p class="mt-1 rounded-lg bg-amber-50 p-3 text-sm">Already on your list: {existingLabel(item)}. It is skipped by default and will not be changed or combined.</p>{/if}
            {#if item.duplicateOfBatch}<p class="mt-1 rounded-lg bg-amber-50 p-3 text-sm">This name also appears earlier in the pasted list. It is skipped by default so quantities are not combined.</p>{/if}
            <input type="hidden" name={`key-${index}`} value={item.key} />
            <input type="hidden" name={`line-${index}`} value={item.line} />
            <label class="mt-3 block">Item name<input name={`name-${index}`} defaultValue={item.name} required maxlength="200" class="mt-1 block w-full rounded-lg border p-3" /></label>
            <label class="mt-3 block">Quantity<input name={`quantity-${index}`} defaultValue={item.quantity} maxlength="60" class="mt-1 block w-full rounded-lg border p-3" /></label>
            <label class="mt-3 block">Unit<input name={`unit-${index}`} defaultValue={item.unit} maxlength="60" class="mt-1 block w-full rounded-lg border p-3" /></label>
            {#if amount(item)}<p class="mt-2 text-sm text-slate-700">Parsed amount: {amount(item)}</p>{/if}
            <fieldset class="mt-3">
              <legend class="font-semibold">Decision</legend>
              <label class="flex min-h-11 items-center gap-3"><input type="radio" name={`action-${index}`} value="add" defaultChecked={item.action === 'add'} class="h-5 w-5" /> Add this item</label>
              <label class="flex min-h-11 items-center gap-3"><input type="radio" name={`action-${index}`} value="skip" defaultChecked={item.action === 'skip'} class="h-5 w-5" /> Skip this item</label>
            </fieldset>
            {#if item.existing || item.duplicateOfBatch}<p class="mt-2 text-sm text-slate-700">Bulk entry does not create an intentional duplicate. To keep a separate duplicate, skip it here and use the individual Add item form on the grocery list.</p>{/if}
          </fieldset>
        {/each}
        <div class="flex flex-wrap items-center gap-3">
          <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Add selected items</button>
          <a href={resolve('/groceries')} class="py-3 text-teal-700">Cancel without saving</a>
        </div>
      </form>
    </section>
  {/if}
</main>
