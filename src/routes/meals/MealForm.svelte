<script lang="ts">
  type Fields = { id?: string; title?: string; date: string; time?: string | null; servings?: number | string | null; ingredients?: string; notes?: string | null; source?: string | null; recipeUrl?: string | null; shared?: boolean };
  let { initial, label, viewDate }: { initial: Fields; label: string; viewDate: string } = $props();
  let title = $derived(initial.title ?? ''), date = $derived(initial.date), time = $derived(initial.time ?? ''), servings = $derived(initial.servings ? Number(initial.servings) : undefined), ingredients = $derived(initial.ingredients ?? ''), notes = $derived(initial.notes ?? ''), source = $derived(initial.source ?? ''), recipeUrl = $derived(initial.recipeUrl ?? ''), shared = $derived(initial.shared ?? false);
</script>
<form method="POST" action={`?/save&date=${encodeURIComponent(viewDate)}`} aria-label={label} class="mt-4 grid gap-3">
  {#if initial.id}<input type="hidden" name="id" value={initial.id} />{/if}
  <label>Meal name<input name="title" bind:value={title} required maxlength="120" class="mt-1 block w-full rounded-lg border p-3" /></label>
  <label>Date<input name="date" type="date" bind:value={date} required class="mt-1 block w-full rounded-lg border p-3" /></label>
  <label>Serving time (optional)<input name="time" type="time" bind:value={time} class="mt-1 block w-full rounded-lg border p-3" /></label>
  <label>Servings (optional)<input name="servings" type="number" min="1" max="100" bind:value={servings} class="mt-1 block w-full rounded-lg border p-3" /></label>
  <label>Ingredients <span class="text-sm">(one per line, with quantities)</span><textarea name="ingredients" maxlength="5000" bind:value={ingredients} rows="4" class="mt-1 block w-full rounded-lg border p-3"></textarea></label>
  <label>Private notes (optional)<textarea name="notes" maxlength="1000" bind:value={notes} class="mt-1 block w-full rounded-lg border p-3"></textarea></label>
  <label>Recipe source (optional)<input name="source" maxlength="120" bind:value={source} class="mt-1 block w-full rounded-lg border p-3" /></label>
  <label>Recipe link (optional)<input name="recipeUrl" type="url" bind:value={recipeUrl} maxlength="2048" class="mt-1 block w-full rounded-lg border p-3" /></label>
  <label class="flex items-center gap-3"><input name="shared" type="checkbox" bind:checked={shared} class="h-5 w-5" />Share on family display</label>
  <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Save meal</button>
</form>
