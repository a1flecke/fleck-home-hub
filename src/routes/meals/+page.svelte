<script lang="ts">
  import { resolve } from '$app/paths';
  import Disclosure from '../calendar/Disclosure.svelte';
  import MealForm from './MealForm.svelte';
  import IngredientForm from './IngredientForm.svelte';
  import { ingredientLines } from '../../lib/grocery/domain';
  import type { PageData } from './$types';
  type MealError = { id: string; title: string; date: string; time: string; servings: string; ingredients: string; notes: string; source: string; recipeUrl: string; shared: boolean };
  let { data, form }: { data: PageData; form: { message: string; mealError?: MealError; ingredientError?: { id: string; selections: string[]; duplicate: boolean } } | null } = $props();
  let selectedDate = $derived(data.date);
</script>
<svelte:head><title>Meals · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-4xl px-5 py-8">
  <a href={resolve('/dashboard')} class="text-teal-700">Back to home</a>
  <h1 class="mt-5 text-3xl font-bold">What's cooking?</h1>
  <form method="GET" class="mt-4 flex flex-wrap items-end gap-3"><label>Choose a date<input name="date" type="date" bind:value={selectedDate} required class="mt-1 block rounded-lg border p-3" /></label><button class="rounded-xl border border-teal-700 px-4 py-3">Show meals</button></form>
  {#if form?.message}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4">{form.message}</p>{/if}
  {#if data.role === 'parent'}
    <Disclosure class="mt-6 rounded-2xl bg-white p-5 shadow-sm" expanded={!!form?.mealError && !form.mealError.id}><summary class="cursor-pointer text-xl font-bold">Add a meal</summary><MealForm label="Add meal" viewDate={data.date} initial={form?.mealError && !form.mealError.id ? form.mealError : { date: data.date }} /></Disclosure>
  {/if}
  <section aria-label="Planned meals" class="mt-6"><h2 class="text-2xl font-bold">Meals for {data.date}</h2>
    {#each data.meals as meal (meal.id)}<article class="mt-4 rounded-2xl bg-white p-5 shadow-sm"><h3 class="text-xl font-bold">{meal.title}</h3>{#if meal.time}<p>{meal.time}</p>{/if}{#if meal.servings}<p>Serves {meal.servings}</p>{/if}{#if meal.ingredients}<p class="mt-3 whitespace-pre-line">{meal.ingredients}</p>{/if}{#if meal.notes}<p class="mt-3">{meal.notes}</p>{/if}{#if meal.source}<p class="mt-3">Source: {meal.source}</p>{/if}{#if meal.recipeUrl}<a href={meal.recipeUrl} rel="external noopener noreferrer" class="mt-3 inline-block text-teal-700">View recipe</a>{/if}
      {#if data.role === 'parent'}<Disclosure class="mt-4" expanded={form?.mealError?.id === meal.id}><summary class="cursor-pointer font-bold">Edit meal</summary><MealForm label={`Edit ${meal.title}`} viewDate={data.date} initial={form?.mealError?.id === meal.id ? form.mealError : meal} /></Disclosure>
        {#if ingredientLines(meal.ingredients).length}<Disclosure class="mt-4" expanded={form?.ingredientError?.id === meal.id}><summary class="cursor-pointer font-bold">Add ingredients to groceries</summary>
          <IngredientForm id={meal.id} title={meal.title} ingredients={meal.ingredients} date={data.date} initial={form?.ingredientError?.id === meal.id ? form.ingredientError.selections : []} duplicate={form?.ingredientError?.id === meal.id && form.ingredientError.duplicate} /></Disclosure>{/if}
      {/if}</article>{:else}<p class="mt-4">No meals planned for this day yet.</p>{/each}
  </section>
</main>
