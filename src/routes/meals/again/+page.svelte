<script lang="ts">
  import { resolve } from '$app/paths';
  import RecipeCredit from '../../../lib/meals/RecipeCredit.svelte';
  import RecipeDetails from '../../../lib/meals/RecipeDetails.svelte';
  import type { RecipeDetails as RecipeDetailsType } from '../../../lib/meals/recipe-details';
  import type { PageData } from './$types';

  type Draft = { title: string; date: string; time: string; servings: number | null; ingredients: string; source: string | null; recipeUrl: string | null; recipeDetails: RecipeDetailsType | null; shared: boolean; submissionKey?: string };
  type CopyError = { sourceId: string; title: string; date: string; time: string; servings: string; ingredients: string; source: string; recipeUrl: string; submissionKey: string; shared: boolean; recipeDetails?: RecipeDetailsType | null };
  type Form = { message?: string; copyError?: CopyError; copyPreview?: Draft; gone?: boolean };
  let { data, form }: { data: PageData; form: Form | null } = $props();
  let preview = $derived(form?.copyPreview);
  let gone = $derived(Boolean(form?.gone || data.sourceMissing));
  let edit = $derived(gone ? undefined : (form?.copyError ?? data.draft));
  let title = $derived(edit?.title ?? '');
  let date = $derived(edit?.date ?? data.today);
  let time = $derived(edit?.time ?? '');
  let servings = $derived(edit?.servings ?? undefined);
  let ingredients = $derived(edit?.ingredients ?? '');
  let source = $derived(edit?.source ?? '');
  let recipeUrl = $derived(edit?.recipeUrl ?? '');
  let detailsJson = $derived(edit?.recipeDetails ? JSON.stringify(edit.recipeDetails) : '');
  let sourceId = $derived(form?.copyError?.sourceId ?? data.sourceId);
  let submissionKey = $derived(edit?.submissionKey ?? data.submissionKey);
  let search = $derived(data.query);
  let actionContext = $derived(`source=${encodeURIComponent(sourceId || data.sourceId)}&q=${encodeURIComponent(search)}`);
</script>
<svelte:head><title>Plan it again · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-3xl px-5 py-8">
  <a href={resolve(`/meals?date=${data.today}`)} class="text-teal-700">Back to the meal planner</a>
  <h1 class="mt-5 text-3xl font-bold">Plan it again</h1>
  <p class="mt-2">Repeat a dinner the family already enjoyed. You can check and adjust it before anything is saved.</p>

  {#if form?.message}<p role="status" class="mt-4 rounded-xl bg-amber-50 p-4">{form.message}</p>{/if}
  {#if gone}
    <p class="mt-4 rounded-2xl bg-white p-5 text-slate-700">That meal is no longer available, so there is nothing to repeat. Choose another dinner below.</p>
  {/if}

  {#if !preview && !edit}
    <form method="GET" action={resolve('/meals/again')} aria-label="Search recent meals" class="mt-6 grid gap-3 rounded-2xl bg-white p-5 shadow-sm">
      <label>Search past dinners<input name="q" defaultValue={search} maxlength="80" class="mt-1 block w-full rounded-lg border p-3" /></label>
      <button class="rounded-xl border border-teal-700 px-4 py-3">Search</button>
    </form>
    <section aria-label="Recent meals" class="mt-6">
      <h2 class="text-2xl font-bold">{search ? `Meals matching “${search}”` : 'Recent household dinners'}</h2>
      {#if data.recent.length}
        <p class="mt-2 text-sm text-slate-700">Showing up to {data.recent.length} recent meals. Choose one to preview a new plan.</p>
        {#each data.recent as meal (meal.id)}
          <article class="mt-4 rounded-2xl bg-white p-5 shadow-sm">
            <h3 class="text-xl font-bold">{meal.title}</h3>
            <p class="mt-1 text-sm">{meal.date}{#if meal.time} · {meal.time}{/if}{#if meal.servings} · serves {meal.servings}{/if}</p>
            <RecipeCredit source={meal.source} recipeUrl={meal.recipeUrl} />
            <a href={resolve(`/meals/again?source=${meal.id}&q=${encodeURIComponent(search)}`)} aria-label={`Plan again: ${meal.title}`} class="mt-3 inline-block py-2 text-teal-700 underline">Plan again</a>
          </article>
        {/each}
      {:else}
        <p class="mt-3 rounded-2xl bg-white p-5 text-slate-700">{search ? 'No saved dinners match that search.' : 'No meals to repeat yet. Plan a meal first, then it will appear here.'}</p>
      {/if}
    </section>
  {:else if preview}
    <section aria-label="Plan preview" class="mt-6 rounded-2xl bg-white p-5 shadow-sm">
      <h2 class="text-2xl font-bold">Plan preview</h2>
      <p class="mt-2 text-sm">Review this new private plan. The original meal stays unchanged.</p>
      <dl class="mt-4 grid gap-2">
        <div><dt class="font-semibold">Meal name</dt><dd>{preview.title}</dd></div>
        <div><dt class="font-semibold">Date</dt><dd>{preview.date}</dd></div>
        {#if preview.time}<div><dt class="font-semibold">Serving time</dt><dd>{preview.time}</dd></div>{/if}
        {#if preview.servings}<div><dt class="font-semibold">Servings</dt><dd>{preview.servings}</dd></div>{/if}
      </dl>
      <RecipeCredit source={preview.source} recipeUrl={preview.recipeUrl} />
      <RecipeDetails details={preview.recipeDetails} />
      {#if preview.ingredients}<p class="mt-3 whitespace-pre-line">{preview.ingredients}</p>{/if}
      <form method="POST" action={`?/save&${actionContext}&date=${encodeURIComponent(preview.date)}`} aria-label="Save this plan" class="mt-4 grid gap-3">
        <input type="hidden" name="sourceId" value={sourceId} />
        <input type="hidden" name="title" value={preview.title} />
        <input type="hidden" name="date" value={preview.date} />
        <input type="hidden" name="time" value={preview.time} />
        <input type="hidden" name="servings" value={preview.servings ?? ''} />
        <input type="hidden" name="ingredients" value={preview.ingredients} />
        <input type="hidden" name="source" value={preview.source ?? ''} />
        <input type="hidden" name="recipeUrl" value={preview.recipeUrl ?? ''} />
        <input type="hidden" name="recipeDetails" value={preview.recipeDetails ? JSON.stringify(preview.recipeDetails) : ''} />
        <input type="hidden" name="submissionKey" value={preview.submissionKey ?? submissionKey} />
        <label class="flex min-h-11 items-center gap-3"><input name="shared" type="checkbox" class="h-5 w-5" />Share this new meal on the family display</label>
        <div class="flex flex-wrap items-center gap-3">
          <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Save this plan</button>
          <a href={resolve(`/meals/again?source=${sourceId}&q=${encodeURIComponent(search)}`)} class="py-3 text-teal-700">Change details</a>
          <a href={resolve(`/meals?date=${data.today}`)} class="py-3 text-teal-700">Cancel</a>
        </div>
      </form>
    </section>
  {:else if edit}
    <section aria-label="Adjust the new plan" class="mt-6 rounded-2xl bg-white p-5 shadow-sm">
      <h2 class="text-2xl font-bold">Plan again: {edit.title}</h2>
      <p class="mt-2 text-sm">Nothing is saved yet. Adjust the details, then preview the new plan.</p>
      <form method="POST" action={`?/preview&${actionContext}`} aria-label="Preview a meal plan" class="mt-4 grid gap-3">
        <input type="hidden" name="sourceId" value={sourceId} />
        <input type="hidden" name="submissionKey" value={submissionKey} />
        {#if detailsJson}<input type="hidden" name="recipeDetails" value={detailsJson} />{/if}
        <label>Meal name<input name="title" required maxlength="120" defaultValue={title} class="mt-1 block w-full rounded-lg border p-3" /></label>
        <label>New date<input name="date" type="date" required bind:value={date} class="mt-1 block w-full rounded-lg border p-3" /></label>
        <label>Serving time (optional)<input name="time" type="time" bind:value={time} class="mt-1 block w-full rounded-lg border p-3" /></label>
        <label>Servings (optional)<input name="servings" type="number" min="1" max="100" defaultValue={servings ?? ''} class="mt-1 block w-full rounded-lg border p-3" /></label>
        <label>Ingredients <span class="text-sm">(one per line, with quantities)</span><textarea name="ingredients" maxlength="5000" bind:value={ingredients} rows="5" class="mt-1 block w-full rounded-lg border p-3"></textarea></label>
        <label>Recipe source (optional)<input name="source" maxlength="120" defaultValue={source} class="mt-1 block w-full rounded-lg border p-3" /></label>
        <label>Recipe link (optional)<input name="recipeUrl" type="url" maxlength="2048" defaultValue={recipeUrl} class="mt-1 block w-full rounded-lg border p-3" /></label>
        <p class="text-sm">The new meal is private unless you choose to share it after the preview. Its private notes are not copied.</p>
        <div class="flex flex-wrap items-center gap-3">
          <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Preview plan</button>
          <a href={resolve(`/meals?date=${data.today}`)} class="py-3 text-teal-700">Cancel</a>
        </div>
      </form>
    </section>
  {/if}
</main>
