<script lang="ts">
  import { resolve } from '$app/paths';
  import Disclosure from '../calendar/Disclosure.svelte';
  import MealForm from './MealForm.svelte';
  import IngredientForm from './IngredientForm.svelte';
  import IngredientReview from './IngredientReview.svelte';
  import { ingredientLines } from '../../lib/grocery/domain';
  import type { IngredientReview as IngredientReviewData } from '../../lib/grocery/handoff';
  import RecipeCredit from '../../lib/meals/RecipeCredit.svelte';
  import RecipeDetails from '../../lib/meals/RecipeDetails.svelte';
  import type { RecipeDetails as RecipeDetailsType } from '../../lib/meals/recipe-details';
  import { recipeAttribution } from '../../lib/meals/recipe-link';
  import type { PageData } from './$types';
  type MealError = { id: string; title: string; date: string; time: string; servings: string; ingredients: string; notes: string; source: string; recipeUrl: string; recipeDetails?: RecipeDetailsType | null; suggestedTitle?: string; shared: boolean; submissionKey?: string; mode?: string };
  type RecipeDraft = { recipeUrl: string; title: string; date: string; time?: string; servings?: string; ingredients?: string; notes?: string; source?: string; recipeDetails?: RecipeDetailsType | null; suggestedTitle?: string; shared?: boolean; submissionKey: string; mode: string };
  type Form = { message?: string; mealError?: MealError; moveError?: { id: string; date: string }; removeError?: string; ingredientError?: { id: string; selections: string[] }; ingredientReview?: IngredientReviewData; recipeLinkError?: { recipeUrl: string }; recipeDraft?: RecipeDraft };
  let { data, form }: { data: PageData; form: Form | null } = $props();
  let selectedDate = $derived(data.date);
  let draft = $derived(form?.recipeDraft ?? (form?.mealError && !form.mealError.id && form.mealError.mode === 'recipeLink' ? form.mealError : undefined));
  let newMeal = $derived(form?.mealError && !form.mealError.id && form.mealError.mode !== 'recipeLink' ? form.mealError : undefined);
</script>
<svelte:head><title>Meals · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-4xl px-5 py-8">
  <a href={resolve('/dashboard')} class="text-teal-700">Back to home</a>
  <h1 class="mt-5 text-3xl font-bold">What's cooking?</h1>
  <nav aria-label="Meal week" class="mt-4 flex flex-wrap items-center gap-2 text-teal-700">
    <a href={resolve(`/meals?week=${data.previousWeek}`)} class="rounded-xl border border-teal-700 px-4 py-3">Previous week</a>
    <a href={resolve(`/meals?week=${data.currentWeek}`)} class="rounded-xl border border-teal-700 px-4 py-3">This week</a>
    <a href={resolve(`/meals?week=${data.nextWeek}`)} class="rounded-xl border border-teal-700 px-4 py-3">Next week</a>
  </nav>
  <p class="mt-3 text-lg font-semibold" aria-live="polite">{data.weekLabel}</p>
  <form method="GET" class="mt-4 flex flex-wrap items-end gap-3" aria-label="Jump to a meal date"><label>Jump to a date<input name="date" type="date" bind:value={selectedDate} required class="mt-1 block rounded-lg border p-3" /></label><button class="rounded-xl border border-teal-700 px-4 py-3">Show week</button></form>
  {#if form?.message && !form?.ingredientReview}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4">{form.message}</p>{/if}
  {#if form?.ingredientReview}<IngredientReview review={form.ingredientReview} date={data.date} message={form.message} />{/if}
  {#if data.role === 'parent'}
    <p class="mt-4 flex flex-wrap gap-2"><a href={resolve('/meals/again')} class="rounded-xl border border-teal-700 px-4 py-3 inline-block text-teal-700">Plan it again from a recent meal</a><a href={resolve(`/meals/shop?week=${data.weekStart}`)} class="rounded-xl border border-teal-700 px-4 py-3 inline-block text-teal-700">Shop the week</a></p>
    <div id="add-meal">
      <Disclosure class="mt-6 rounded-2xl bg-white p-5 shadow-sm" expanded={data.plan || !!newMeal}><summary class="cursor-pointer text-xl font-bold">Add a meal</summary><MealForm label="Add meal" viewDate={data.date} initial={newMeal ?? { date: data.date, submissionKey: data.submissionKey }} /></Disclosure>
    </div>
    <Disclosure class="mt-6 rounded-2xl bg-white p-5 shadow-sm" expanded={!!draft || !!form?.recipeLinkError}><summary class="cursor-pointer text-xl font-bold">Add meal from recipe link</summary>
      {#if draft}
        <p class="mt-3 text-sm">Review this private draft. Nothing is saved until you choose Save meal.</p>
        <RecipeCredit recipeUrl={draft.recipeUrl} />
        <RecipeDetails details={draft.recipeDetails ?? null} />
        <MealForm label="Save recipe meal" viewDate={data.date} initial={draft} preview />
        <a href={resolve(`/meals?date=${data.date}`)} class="mt-3 inline-block py-2 text-teal-700">Cancel draft</a>
      {:else}
        <form method="POST" action={`?/draft&date=${encodeURIComponent(data.date)}`} aria-label="Add meal from recipe link" class="mt-3 grid gap-3">
          <input type="hidden" name="date" value={data.date} />
          <label>Recipe link<input name="recipeUrl" type="url" required maxlength="2048" defaultValue={form?.recipeLinkError?.recipeUrl ?? ''} class="mt-1 block w-full rounded-lg border p-3" /></label>
          <p class="text-sm">Paste an HTTPS link from eMeals or another recipe site. Home Hub checks the link but does not open or import the page.</p>
          <button class="rounded-xl border border-teal-700 px-4 py-3">Review draft</button>
        </form>
      {/if}
    </Disclosure>
  {/if}
  <section aria-label="Planned meals" class="mt-6">
    {#each data.weekDays as day (day.date)}
      <section aria-label={`Meals for ${day.date}`} class="mt-5 rounded-2xl bg-white p-5 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-2xl font-bold">Meals for {day.date}</h2>
          {#if day.isToday}<span class="rounded-full bg-teal-50 px-3 py-1 text-sm font-bold text-teal-900">Today</span>{/if}
        </div>
        <p class="text-sm text-slate-700">{day.label}</p>
        {#if data.role === 'parent'}
          <a href={resolve(`/meals?date=${day.date}&plan=1#add-meal`)} aria-label={`${day.meals.length ? 'Add another meal' : 'Plan a meal'} for ${day.date}`} class="mt-2 inline-block py-2 text-teal-700 underline">{day.meals.length ? 'Add another meal' : 'Plan a meal'}</a>
        {/if}
        {#each day.meals as meal (meal.id)}
          {@const attribution = recipeAttribution(meal.source, meal.recipeUrl)}
          <article class="mt-4 rounded-2xl border border-slate-200 p-4">
            <h3 class="text-xl font-bold">{meal.title}</h3>
            {#if meal.time}<p>{meal.time}</p>{/if}
            {#if meal.servings}<p>Serves {meal.servings}</p>{/if}
            <RecipeCredit source={meal.source} recipeUrl={meal.recipeUrl} />
            <RecipeDetails details={meal.recipeDetails} />
            {#if meal.ingredients}
              {#if attribution?.verifiedSource}<p class="mt-3 text-sm font-semibold">Family-entered ingredients</p>{/if}
              <p class="mt-1 whitespace-pre-line">{meal.ingredients}</p>
            {/if}
            {#if meal.notes}<p class="mt-3">{meal.notes}</p>{/if}
            {#if data.role === 'parent'}
              <Disclosure class="mt-4" expanded={form?.mealError?.id === meal.id}><summary class="cursor-pointer font-bold">Edit meal</summary><MealForm label={`Edit ${meal.title}`} viewDate={day.date} initial={form?.mealError?.id === meal.id ? form.mealError : meal} /></Disclosure>
              <Disclosure class="mt-4" expanded={form?.moveError?.id === meal.id}><summary class="cursor-pointer font-bold">Move meal</summary>
                <form method="POST" action={`?/move&date=${encodeURIComponent(day.date)}`} aria-label={`Move ${meal.title}`} class="mt-3 grid gap-3">
                  <input type="hidden" name="id" value={meal.id} />
                  <label>New date<input name="date" type="date" required defaultValue={form?.moveError?.id === meal.id ? form.moveError.date : meal.date} class="mt-1 block w-full rounded-lg border p-3" /></label>
                  <button class="rounded-xl border border-teal-700 px-4 py-3">Move meal</button>
                </form>
              </Disclosure>
              <Disclosure class="mt-4" expanded={form?.removeError === meal.id}><summary class="cursor-pointer font-bold">Remove meal…</summary>
                <p class="mt-2 text-sm">This permanently removes this meal, its ingredients and its private notes. There is no undo.</p>
                <form method="POST" action={`?/remove&date=${encodeURIComponent(day.date)}`} aria-label={`Remove ${meal.title}`} class="mt-3">
                  <input type="hidden" name="id" value={meal.id} />
                  <input type="hidden" name="returnDate" value={data.date} />
                  <button class="rounded-xl border border-red-700 px-4 py-3 text-red-800">Remove this meal</button>
                </form>
              </Disclosure>
              {#if ingredientLines(meal.ingredients).length || meal.recipeDetails?.groups.length}
                <Disclosure class="mt-4" expanded={form?.ingredientError?.id === meal.id}><summary class="cursor-pointer font-bold">Add ingredients to groceries</summary>
                  <IngredientForm id={meal.id} title={meal.title} ingredients={meal.ingredients} groups={meal.recipeDetails?.groups ?? []} date={day.date} initial={form?.ingredientError?.id === meal.id ? form.ingredientError.selections : []} />
                </Disclosure>
              {/if}
            {/if}
          </article>
        {:else}
          <p class="mt-3 text-slate-700">No meals planned for this day yet.</p>
        {/each}
      </section>
    {/each}
  </section>
</main>
