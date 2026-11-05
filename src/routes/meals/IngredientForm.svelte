<script lang="ts">
  import { ingredientLines } from '../../lib/grocery/domain';
  import type { RecipeIngredientGroup } from '../../lib/meals/recipe-details';
  let { id, title, ingredients, groups = [], date, initial, duplicate }: { id: string; title: string; ingredients: string; groups?: RecipeIngredientGroup[]; date: string; initial: string[]; duplicate: boolean } = $props();
  let selections = $derived([...initial]);
  let familyLines = $derived(ingredientLines(ingredients));
</script>
<form method="POST" action={`?/ingredients&date=${encodeURIComponent(date)}`} aria-label={`Add ingredients for ${title}`} class="mt-3 grid gap-3">
  <input type="hidden" name="id" value={id} />
  {#if groups.length}
    <fieldset>
      <legend class="font-semibold">Recipe ingredients from eMeals</legend>
      {#each groups as group, groupIndex (groupIndex)}
        <div class="mt-2">
          <h4 class="font-semibold">{group.name}</h4>
          {#each group.lines as ingredient, lineIndex (`${groupIndex}:${lineIndex}:${ingredient}`)}<label class="flex items-center gap-3"><input type="checkbox" name="ingredient" value={ingredient} bind:group={selections} />{ingredient}</label>{/each}
        </div>
      {/each}
    </fieldset>
  {/if}
  {#if familyLines.length}
    <fieldset>
      <legend class="font-semibold">Family-entered ingredients</legend>
      {#each familyLines as ingredient, i (`${i}:${ingredient}`)}<label class="flex items-center gap-3"><input type="checkbox" name="ingredient" value={ingredient} bind:group={selections} />{ingredient}</label>{/each}
    </fieldset>
  {/if}
  {#if duplicate}<label><input type="checkbox" name="allowDuplicate" value="yes" required /> Add matching items anyway</label>{/if}
  <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Add selected ingredients</button>
</form>
