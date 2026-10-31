<script lang="ts">
  import { ingredientLines } from '../../lib/grocery/domain';
  let { id, title, ingredients, date, initial, duplicate }: { id: string; title: string; ingredients: string; date: string; initial: string[]; duplicate: boolean } = $props();
  let selections = $derived([...initial]);
</script>
<form method="POST" action={`?/ingredients&date=${encodeURIComponent(date)}`} aria-label={`Add ingredients for ${title}`} class="mt-3 grid gap-3">
  <input type="hidden" name="id" value={id} />
  {#each ingredientLines(ingredients) as ingredient, i (`${i}:${ingredient}`)}<label class="flex items-center gap-3"><input type="checkbox" name="ingredient" value={ingredient} bind:group={selections} />{ingredient}</label>{/each}
  {#if duplicate}<label><input type="checkbox" name="allowDuplicate" value="yes" required /> Add matching items anyway</label>{/if}
  <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Add selected ingredients</button>
</form>
