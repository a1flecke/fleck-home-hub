<script lang="ts">
  import { resolve } from '$app/paths';
  import type { WeekIngredientReview, WeekIngredientReviewItem } from '../../../lib/grocery/week';

  let { review, weekStart, confirmationKey, message }: { review: WeekIngredientReview; weekStart: string; confirmationKey: string; message?: string } = $props();

  function sourceLabel(item: WeekIngredientReviewItem): string {
    if (item.source === 'family') return 'Family-entered ingredients';
    return item.group ? `Recipe ingredients from eMeals · ${item.group}` : 'Recipe ingredients from eMeals';
  }

  function amount(quantity: string, unit: string): string {
    return [quantity, unit].filter(Boolean).join(' ');
  }

  function existingLabel(item: WeekIngredientReviewItem): string {
    if (!item.existing) return '';
    const value = amount(item.existing.quantity, item.existing.unit);
    return value ? `${item.existing.name} (${value})` : item.existing.name;
  }
</script>

<section aria-label="Review week ingredients for groceries" class="mt-6 rounded-2xl bg-white p-5 shadow-sm">
  <h2 class="text-2xl font-bold">Review {review.items.length} {review.items.length === 1 ? 'ingredient' : 'ingredients'}</h2>
  <p class="mt-2 text-sm">Check every name, quantity and unit. Existing items and other selected meals are never changed or combined automatically.</p>
  {#if message}<p role="status" class="mt-3 rounded-xl bg-amber-50 p-3">{message}</p>{/if}
  <form method="POST" action={`?/confirm&week=${encodeURIComponent(weekStart)}`} aria-label="Confirm week ingredients for groceries" class="mt-4 grid gap-4">
    <input type="hidden" name="week" value={weekStart} />
    <input type="hidden" name="confirmationKey" value={confirmationKey} />
    <input type="hidden" name="rowCount" value={review.items.length} />
    {#each review.items as item, index (item.key)}
      <fieldset class="rounded-xl border p-4" data-key={item.key}>
        <legend class="px-1 font-semibold">{item.line}</legend>
        <p class="text-sm">{sourceLabel(item)}</p>
        <p class="mt-1 text-sm"><span class="font-semibold">Needed for:</span> {item.requiredBy.map(requirement => `${requirement.mealTitle} (${requirement.mealDate}${amount(requirement.quantity, requirement.unit) ? `, ${amount(requirement.quantity, requirement.unit)}` : ''})`).join(' · ')}</p>
        {#if item.needsReview}<p class="mt-1 text-sm text-amber-800">This line could not be split confidently. Check the name, quantity and unit.</p>{/if}
        {#if item.duplicateOfSelection}<p class="mt-1 rounded-lg bg-amber-50 p-3 text-sm">This ingredient also appears for another selected meal. Quantities are not combined and this row is skipped by default. Choose Add this item to keep a separate row.</p>{/if}
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
            <label class="flex min-h-11 items-center gap-3"><input type="radio" name={`action-${index}`} value="add" defaultChecked={item.action === 'add'} class="h-5 w-5" /> Add this item</label>
            <label class="flex min-h-11 items-center gap-3"><input type="radio" name={`action-${index}`} value="skip" defaultChecked={item.action === 'skip'} class="h-5 w-5" /> Skip this item</label>
          {/if}
        </fieldset>
      </fieldset>
    {/each}
    <div class="flex flex-wrap items-center gap-3">
      <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Add reviewed ingredients</button>
      <a href={resolve(`/meals/shop?week=${weekStart}`)} class="py-3 text-teal-700">Choose different ingredients</a>
      <a href={resolve('/groceries')} class="py-3 text-teal-700">Cancel</a>
    </div>
  </form>
</section>
