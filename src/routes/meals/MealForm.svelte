<script lang="ts">
  import type { RecipeDetails } from '../../lib/meals/recipe-details';
  import { recipeAttribution } from '../../lib/meals/recipe-link';
  type Fields = { id?: string; title?: string; date: string; time?: string | null; servings?: number | string | null; ingredients?: string; notes?: string | null; source?: string | null; recipeUrl?: string | null; recipeDetails?: RecipeDetails | null; suggestedTitle?: string; shared?: boolean; submissionKey?: string; mode?: string };
  let { initial, label, viewDate, action, preview = false }: { initial: Fields; label: string; viewDate: string; action?: string; preview?: boolean } = $props();
  let title = $derived(initial.title ?? ''), date = $derived(initial.date), time = $derived(initial.time ?? ''), servings = $derived(initial.servings ? Number(initial.servings) : undefined), ingredients = $derived(initial.ingredients ?? ''), notes = $derived(initial.notes ?? ''), source = $derived(initial.source ?? ''), recipeUrl = $derived(initial.recipeUrl ?? ''), shared = $derived(initial.shared ?? false);
  let canPreview = $derived(preview && !!recipeAttribution(null, initial.recipeUrl)?.verifiedSource);
  let detailsJson = $derived(initial.recipeDetails ? JSON.stringify(initial.recipeDetails) : '');
</script>
<form method="POST" action={action ?? `?/save&date=${encodeURIComponent(viewDate)}`} aria-label={label} class="mt-4 grid gap-3">
  {#if initial.id}<input type="hidden" name="id" value={initial.id} />{/if}
  {#if !initial.id && initial.submissionKey}<input type="hidden" name="submissionKey" value={initial.submissionKey} />{/if}
  {#if initial.mode}<input type="hidden" name="mode" value={initial.mode} />{/if}
  {#if initial.suggestedTitle}<input type="hidden" name="suggestedTitle" value={initial.suggestedTitle} />{/if}
  {#if detailsJson}<input type="hidden" name="recipeDetails" value={detailsJson} />{/if}
  <label>Meal name<input name="title" defaultValue={title} required maxlength="120" class="mt-1 block w-full rounded-lg border p-3" /></label>
  <label>Date<input name="date" type="date" bind:value={date} required class="mt-1 block w-full rounded-lg border p-3" /></label>
  <label>Serving time (optional)<input name="time" type="time" bind:value={time} class="mt-1 block w-full rounded-lg border p-3" /></label>
  <label>Servings (optional)<input name="servings" type="number" min="1" max="100" defaultValue={servings ?? ''} class="mt-1 block w-full rounded-lg border p-3" /></label>
  <label>Ingredients <span class="text-sm">(family-entered, one per line, with quantities)</span><textarea name="ingredients" maxlength="5000" bind:value={ingredients} rows="4" class="mt-1 block w-full rounded-lg border p-3"></textarea></label>
  <p class="text-sm">Family-entered ingredients stay separate. Recipe details are read from eMeals only when you choose Preview recipe details.</p>
  <label>Private notes (optional)<textarea name="notes" maxlength="1000" bind:value={notes} class="mt-1 block w-full rounded-lg border p-3"></textarea></label>
  <label>Recipe source (optional)<input name="source" maxlength="120" defaultValue={source} class="mt-1 block w-full rounded-lg border p-3" /></label>
  <label>Recipe link (optional)<input name="recipeUrl" type="url" defaultValue={recipeUrl} maxlength="2048" class="mt-1 block w-full rounded-lg border p-3" /></label>
  <label class="flex items-center gap-3"><input name="shared" type="checkbox" bind:checked={shared} class="h-5 w-5" />Share on family display</label>
  <div class="flex flex-wrap gap-3">
    {#if canPreview}<button name="intent" value="preview" formnovalidate class="rounded-xl border border-teal-700 px-4 py-3">{initial.recipeDetails ? 'Refresh recipe details' : 'Preview recipe details'}</button>{/if}
    <button name="intent" value="save" class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Save meal</button>
  </div>
</form>
