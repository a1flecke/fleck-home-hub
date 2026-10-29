<script lang="ts">
  import { resolve } from '$app/paths';
</script>
<svelte:head><title>Fleck Home Hub</title><meta name="description" content="A welcoming place for the household." /></svelte:head>
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
