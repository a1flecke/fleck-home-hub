<script lang="ts">
  import { resolve } from '$app/paths';
  let { data } = $props();
</script>
<svelte:head><title>Fleck Home Hub</title><meta name="description" content="A welcoming place for the household." /></svelte:head>
{#if data.firstRun}
  <main class="mx-auto max-w-4xl px-6 py-10 sm:py-20">
    <div class="rounded-3xl bg-teal-950 px-7 py-10 text-white sm:px-12 sm:py-14">
      <p class="text-sm font-semibold text-teal-200">Fleck Home Hub</p>
      <h1 class="mt-4 max-w-lg text-4xl font-bold tracking-tight sm:text-5xl">Welcome to your family’s home hub</h1>
      <p class="mt-4 max-w-lg text-lg text-teal-50">Keep track of who’s doing what, what’s for dinner, and what’s coming up. Give everyone a place to see their day.</p>
      <a class="mt-8 inline-block rounded-xl bg-white px-5 py-3 font-semibold text-teal-950" href={resolve('/setup')}>Set up our family</a>
      <p class="mt-4 text-sm text-teal-100">Have your one-time setup code handy. You can invite family and try things out at your own pace.</p>
    </div>
  </main>
{:else}
<main class="mx-auto max-w-5xl px-6 py-12">
  <p class="text-sm font-semibold uppercase tracking-widest text-teal-700">Fleck Home Hub</p>
  <h1 class="mt-3 text-4xl font-bold">Welcome home</h1>
  <p class="mt-4 max-w-xl text-lg">A shared space for the people and plans that make a home.</p>
  <section aria-label="Sample family display" class="mt-10 grid gap-5 sm:grid-cols-3">
    <article class="rounded-2xl bg-white p-6 shadow-sm"><h2 class="text-xl font-semibold">Today</h2><p class="mt-3">Sample event: family walk</p></article>
    <article class="rounded-2xl bg-white p-6 shadow-sm"><h2 class="text-xl font-semibold">Weather</h2><p class="mt-3">Sample forecast: sunny</p></article>
    <article class="rounded-2xl bg-white p-6 shadow-sm"><h2 class="text-xl font-semibold">Dinner</h2><p class="mt-3">Sample meal: vegetable pasta</p></article>
  </section>
  <a class="mt-8 inline-block rounded-xl bg-teal-700 px-5 py-3 font-semibold text-white" href={resolve('/sign-in')}>Sign in</a>
  <p class="mt-8 text-sm">This preview contains example data only.</p>
</main>
{/if}
