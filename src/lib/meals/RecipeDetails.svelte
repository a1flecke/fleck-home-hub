<script lang="ts">
  import type { RecipeDetails } from './recipe-details';
  let { details }: { details?: RecipeDetails | null } = $props();
</script>
{#if details}
  <section aria-label="Recipe details from eMeals" class="mt-3">
    <h4 class="font-semibold">Recipe details from eMeals</h4>
    {#if details.yield}<p>Recipe yield: {details.yield}</p>{/if}
    {#if details.totalTime}<p>Total time: {details.totalTime}</p>{/if}
    {#if details.groups.length}
      <details class="mt-2">
        <summary class="cursor-pointer font-semibold">Recipe ingredients from eMeals</summary>
        {#each details.groups as group, index (index)}
          <div class="mt-2">
            <h5 class="font-semibold">{group.name}</h5>
            <ul class="list-disc pl-5">{#each group.lines as line, lineIndex (`${index}:${lineIndex}`)}<li>{line}</li>{/each}</ul>
          </div>
        {/each}
      </details>
    {/if}
  </section>
{/if}
