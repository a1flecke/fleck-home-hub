<script lang="ts">
  import { resolve } from '$app/paths';
  import MealForm from '../MealForm.svelte';
  import RecipeCredit from '../../../lib/meals/RecipeCredit.svelte';
  import RecipeDetails from '../../../lib/meals/RecipeDetails.svelte';
  import type { RecipeDetails as RecipeDetailsType } from '../../../lib/meals/recipe-details';
  type RecipeDraft = { recipeUrl: string; title: string; date: string; time?: string; servings?: string; ingredients?: string; notes?: string; source?: string; recipeDetails?: RecipeDetailsType | null; suggestedTitle?: string; shared?: boolean; submissionKey: string; mode: string };
  type Form = { message?: string; recipeDraft?: RecipeDraft; sharedText?: string; sharedTitle?: string };
  let { form }: { form: Form | null } = $props();
  let draft = $derived(form?.recipeDraft);
  let sharedLink = $derived(form?.sharedText && !/\s/.test(form.sharedText) ? form.sharedText : '');
</script>
<svelte:head><title>Add meal from recipe link · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-2xl px-5 py-8">
  <a href={resolve('/meals')} class="text-teal-700">Back to meals</a>
  <h1 class="mt-5 text-3xl font-bold">Add meal from recipe link</h1>
  {#if form?.message}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4">{form.message}</p>{/if}
  {#if draft}
    <p class="mt-3">Review this private draft. Nothing is saved until you choose Save meal.</p>
    <RecipeCredit recipeUrl={draft.recipeUrl} />
    <RecipeDetails details={draft.recipeDetails ?? null} />
    <MealForm label="Save recipe meal" viewDate={draft.date} initial={draft} action={`/meals?/save&date=${encodeURIComponent(draft.date)}`} preview />
    <a href={resolve('/meals')} class="mt-3 inline-block py-2 text-teal-700">Cancel draft</a>
  {:else}
    <form method="POST" action={resolve('/meals/share')} aria-label="Add meal from a shared recipe link" class="mt-4 grid gap-3">
      <label>Recipe link<input name="url" type="url" required maxlength="2048" defaultValue={sharedLink} class="mt-1 block w-full rounded-lg border p-3" /></label>
      <p class="text-sm">Paste an HTTPS link from eMeals or another recipe site. Home Hub checks the link but does not open or import the page. On browsers that support it, use Share → Home Hub instead of copying.</p>
      <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Review draft</button>
    </form>
  {/if}
</main>
