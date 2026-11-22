<script lang="ts">
  import { resolve } from '$app/paths';
  import { familyIngredientKey, providerIngredientKey } from '../../../lib/grocery/handoff';
  import type { WeekIngredientReview as WeekReview } from '../../../lib/grocery/week';
  import WeekIngredientReview from './WeekIngredientReview.svelte';
  import type { PageData } from './$types';

  type Form = { message?: string; review?: WeekReview; confirmationKey?: string; selections?: string[]; weekStart?: string };
  let { data, form }: { data: PageData; form: Form | null } = $props();
  let selections = $derived([...(form?.selections ?? [])]);
  let weekStart = $derived(form?.weekStart ?? data.weekStart);
</script>
<svelte:head><title>Shop the week · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-3xl px-5 py-8">
  <a href={resolve(`/meals?week=${weekStart}`)} class="text-teal-700">Back to the meal planner</a>
  <h1 class="mt-5 text-3xl font-bold">Shop the week</h1>
  <p class="mt-2">Choose ingredients from several planned dinners, then review every line before anything is added to the grocery list.</p>
  <nav aria-label="Shopping week" class="mt-4 flex flex-wrap items-center gap-2 text-teal-700">
    <a href={resolve(`/meals/shop?week=${data.previousWeek}`)} class="rounded-xl border border-teal-700 px-4 py-3">Previous week</a>
    <a href={resolve(`/meals/shop?week=${data.currentWeek}`)} class="rounded-xl border border-teal-700 px-4 py-3">This week</a>
    <a href={resolve(`/meals/shop?week=${data.nextWeek}`)} class="rounded-xl border border-teal-700 px-4 py-3">Next week</a>
  </nav>
  <p class="mt-3 text-lg font-semibold">{data.weekLabel}</p>

  {#if form?.review}
    <WeekIngredientReview review={form.review} weekStart={weekStart} confirmationKey={form.confirmationKey ?? data.confirmationKey} message={form.message} />
  {:else}
    {#if form?.message}<p role="status" class="mt-4 rounded-xl bg-amber-50 p-4">{form.message}</p>{/if}
    {#if !data.mealCount}
      <p class="mt-6 rounded-2xl bg-white p-5 text-slate-700">No meals are planned for this week. <a href={resolve(`/meals?week=${data.weekStart}`)} class="text-teal-700 underline">Plan some dinners first.</a></p>
    {:else if !data.hasIngredients}
      <p class="mt-6 rounded-2xl bg-white p-5 text-slate-700">The planned meals do not have ingredient lines yet. <a href={resolve(`/meals?week=${data.weekStart}`)} class="text-teal-700 underline">Add ingredients in the planner.</a></p>
    {:else}
      <form method="POST" action={`?/review&week=${encodeURIComponent(weekStart)}`} aria-label="Select ingredients for the week" class="mt-6 grid gap-4">
        <input type="hidden" name="week" value={weekStart} />
        {#each data.days as day (day.date)}
          {#if day.meals.length}
            <section aria-label={`Ingredients for ${day.date}`} class="rounded-2xl bg-white p-5 shadow-sm">
              <h2 class="text-xl font-bold">{day.label}</h2>
              <p class="text-sm text-slate-700">{day.date}</p>
              {#each day.meals as meal (meal.id)}
                <article class="mt-4 rounded-xl border border-slate-200 p-4">
                  <h3 class="text-lg font-bold">{meal.title}</h3>
                  {#if meal.time}<p class="text-sm">{meal.time}</p>{/if}
                  {#if meal.familyLines.length}
                    <fieldset class="mt-3">
                      <legend class="font-semibold">Family-entered ingredients</legend>
                      {#each meal.familyLines as line, index (`family:${index}`)}
                        <label class="flex min-h-11 items-center gap-3"><input type="checkbox" name="ingredient" value={`${meal.id}:${familyIngredientKey(index)}`} bind:group={selections} class="h-5 w-5" />{line}</label>
                      {/each}
                    </fieldset>
                  {/if}
                  {#each meal.groups as group, groupIndex (groupIndex)}
                    <fieldset class="mt-3">
                      <legend class="font-semibold">Recipe ingredients from eMeals · {group.name}</legend>
                      {#each group.lines as line, lineIndex (`${groupIndex}:${lineIndex}`)}
                        <label class="flex min-h-11 items-center gap-3"><input type="checkbox" name="ingredient" value={`${meal.id}:${providerIngredientKey(groupIndex, lineIndex)}`} bind:group={selections} class="h-5 w-5" />{line}</label>
                      {/each}
                    </fieldset>
                  {/each}
                  {#if !meal.familyLines.length && !meal.groups.length}<p class="mt-2 text-sm text-slate-700">No ingredients saved for this meal.</p>{/if}
                </article>
              {/each}
            </section>
          {/if}
        {/each}
        <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Review selected ingredients</button>
      </form>
    {/if}
  {/if}
</main>
