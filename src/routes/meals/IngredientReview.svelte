<script lang="ts">
  import { resolve } from '$app/paths';
  import type { IngredientReviewItem, IngredientReview } from '../../lib/grocery/handoff';
  let { review, date, message }: { review: IngredientReview; date: string; message?: string } = $props();

  function sourceLabel(item: IngredientReviewItem): string {
    if (item.source === 'family') return 'Family-entered ingredients';
    return item.group ? `Recipe ingredients from eMeals · ${item.group}` : 'Recipe ingredients from eMeals';
  }

  function existingLabel(item: IngredientReviewItem): string {
    if (!item.existing) return '';
    const amount = [item.existing.quantity, item.existing.unit].filter(Boolean).join(' ');
    return amount ? `${item.existing.name} (${amount})` : item.existing.name;
  }
</script>

<section aria-label="Review ingredients for groceries" class="mt-6 rounded-2xl bg-white p-5 shadow-sm">
  <h2 class="text-2xl font-bold">Review ingredients</h2>
  <p class="mt-2 text-sm">Check each name, quantity and unit before adding it to the grocery list. Existing items are never changed or combined automatically.</p>
  {#if message}<p role="status" class="mt-3 rounded-xl bg-amber-50 p-3">{message}</p>{/if}
  <form method="POST" action={`?/ingredientsConfirm&date=${encodeURIComponent(date)}`} aria-label={`Confirm ingredients for ${review.mealTitle}`} class="mt-4 grid gap-4">
    <input type="hidden" name="id" value={review.mealId} />
    <input type="hidden" name="rowCount" value={review.items.length} />
    {#each review.items as item, index (item.key)}
      <fieldset class="rounded-xl border p-4" data-key={item.key}>
        <legend class="px-1 font-semibold">{item.line}</legend>
        <p class="text-sm">{sourceLabel(item)}</p>
        {#if item.needsReview}<p class="mt-1 text-sm text-amber-800">This line could not be split confidently. Check the name, quantity and unit.</p>{/if}
        {#if item.duplicateOfSelection}<p class="mt-1 text-sm text-amber-800">Also selected from another ingredient group. It is included once by default.</p>{/if}
        {#if item.existing}<p class="mt-1 rounded-lg bg-amber-50 p-3 text-sm">Already on your list: {existingLabel(item)}. Quantities are not combined.</p>{/if}
        <input type="hidden" name={`key-${index}`} value={item.key} />
        <input type="hidden" name={`line-${index}`} value={item.line} />
        <label class="mt-3 block">Item name<input name={`name-${index}`} defaultValue={item.name} required maxlength="200" class="mt-1 block w-full rounded-lg border p-3" /></label>
        <label class="mt-3 block">Quantity<input name={`quantity-${index}`} defaultValue={item.quantity} maxlength="60" class="mt-1 block w-full rounded-lg border p-3" /></label>
        <label class="mt-3 block">Unit<input name={`unit-${index}`} defaultValue={item.unit} maxlength="60" class="mt-1 block w-full rounded-lg border p-3" /></label>
        <fieldset class="mt-3">
          <legend class="font-semibold">Action</legend>
          {#if item.existing}
            <label class="flex min-h-11 items-center gap-3"><input type="radio" name={`action-${index}`} value="skip" defaultChecked={item.action === 'skip'} class="h-5 w-5" /> Skip this item</label>
            <label class="flex min-h-11 items-center gap-3"><input type="radio" name={`action-${index}`} value="duplicate" defaultChecked={item.action === 'duplicate'} class="h-5 w-5" /> Keep separate duplicate</label>
          {:else}
            <label class="flex min-h-11 items-center gap-3"><input type="radio" name={`action-${index}`} value="add" defaultChecked={item.action === 'add'} class="h-5 w-5" /> Add as new item</label>
            <label class="flex min-h-11 items-center gap-3"><input type="radio" name={`action-${index}`} value="skip" defaultChecked={item.action === 'skip'} class="h-5 w-5" /> Skip this item</label>
          {/if}
        </fieldset>
      </fieldset>
    {/each}
    <div class="flex flex-wrap items-center gap-3">
      <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Add reviewed items</button>
      <a href={resolve(`/meals?date=${encodeURIComponent(date)}`)} class="py-3 text-teal-700">Cancel</a>
    </div>
  </form>
</section>
