<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { recipeLinkLabel } from '../../lib/meals/recipe-link';
  let { data } = $props();
  let current = $derived(data);
  let ready = $state(false);
  let updating = $state(true);
  let refreshError = $state(false);
  let generation = 0;
  onMount(() => {
    ready = true;
    let inFlight = false;
    let controller: AbortController | undefined;
    let disposed = false;
    const timer = setInterval(() => {
      if (updating && !inFlight) {
        inFlight = true;
        const requestGeneration = generation;
        const active = () => !disposed && updating && requestGeneration === generation;
        controller = new AbortController();
        const timeout = setTimeout(() => controller?.abort(), 15_000);
        void fetch(resolve('/display/data'), { cache: 'no-store', signal: controller.signal }).then(async response => {
          if (!active()) return;
          if (response.redirected || response.status === 401 || response.status === 403) { window.location.assign(resolve('/sign-in')); return; }
          if (!response.ok) throw new Error('Display refresh failed');
          const next = await response.json();
          if (active()) { current = next; refreshError = false; }
        }).catch(() => { if (active()) refreshError = true; }).finally(() => { clearTimeout(timeout); inFlight = false; });
      }
    }, 60_000);
    return () => { disposed = true; clearInterval(timer); controller?.abort(); };
  });
</script>
<svelte:head><title>Family display · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-7xl px-5 py-8">
  <a href={resolve('/dashboard')} class="text-teal-700">Back to My Day</a>
  <h1 class="mt-5 text-4xl font-bold">Family display</h1>
  <p class="mt-2 text-lg">{current.today} · {current.timezone}</p>
  {#if refreshError}<p role="status" class="mt-3">Unable to update the display. Check the connection and refresh.</p>{/if}
  <div class="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
    <section aria-label="Weather" class="rounded-2xl bg-teal-50 p-6 shadow-sm ring-1 ring-teal-100">
      <h2 class="flex items-center gap-2 text-2xl font-bold">
        <svg aria-hidden="true" viewBox="0 0 24 24" class="h-7 w-7 shrink-0 text-amber-500" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="12" cy="12" r="4"></circle>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path>
        </svg>
        Weather
      </h2>
      {#if current.weather.status === 'available'}
        {@const forecast = current.weather}
        {#if forecast.temperatureF !== null}
          <p class="mt-4 text-6xl font-bold tracking-tight sm:text-7xl">{forecast.temperatureF}°F</p>
          <p class="mt-1 text-lg font-medium text-teal-800">Near-term hourly forecast</p>
        {:else}
          <p class="mt-4 text-2xl font-semibold">Today's forecast</p>
        {/if}
        {#if forecast.description}<p class="mt-3 text-xl font-semibold sm:text-2xl">{forecast.description}</p>{/if}
        {#if forecast.highF !== null || forecast.lowF !== null}
          <p class="mt-3 text-xl sm:text-2xl">
            {#if forecast.highF !== null}High {forecast.highF}°F{/if}
            {#if forecast.highF !== null && forecast.lowF !== null}<span aria-hidden="true"> · </span>{/if}
            {#if forecast.lowF !== null}Low {forecast.lowF}°F{/if}
          </p>
        {/if}
        {#if forecast.temperatureF === null && forecast.highF === null && forecast.lowF === null && !forecast.description}
          <p class="mt-4 text-xl">Forecast details are unavailable right now.</p>
        {/if}
        {#if !forecast.fresh}
          <p role="status" class="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-base font-medium">Older forecast. Retrieved {forecast.retrievedAtLabel}.</p>
        {:else if forecast.forecastUpdatedLabel}
          <p class="mt-4 text-base">Forecast updated {forecast.forecastUpdatedLabel}.</p>
        {/if}
        <p class="mt-4 text-sm">Weather data from <a href="https://www.weather.gov/" rel="external noopener noreferrer" class="text-teal-700 underline">NOAA / National Weather Service</a>.</p>
      {:else}
        <p class="mt-4 text-xl">Weather is unavailable right now.</p>
      {/if}
    </section>
    <section aria-label="Today's events" class="rounded-2xl bg-white p-6 shadow-sm"><h2 class="text-2xl font-bold">Today's events</h2>
      {#each current.events.filter(event => event.date === current.today) as event (`${event.id}-${event.date}`)}<article class="mt-4"><h3 class="text-lg font-semibold">{event.title}</h3><p>{event.allDay ? 'All day' : `${event.startTime}–${event.endTime}`}</p></article>{:else}<p class="mt-4">No shared events today.</p>{/each}
    </section>
    <section aria-label="Upcoming events" class="rounded-2xl bg-white p-6 shadow-sm"><h2 class="text-2xl font-bold">Coming up</h2>
      {#each current.events.filter(event => event.date > current.today) as event (`${event.id}-${event.date}`)}<article class="mt-4"><h3 class="text-lg font-semibold">{event.title}</h3><p>{event.date} · {event.allDay ? 'All day' : `${event.startTime}–${event.endTime}`}</p></article>{:else}<p class="mt-4">No shared events coming up.</p>{/each}
    </section>
    <section aria-label="Shared chores" class="rounded-2xl bg-white p-6 shadow-sm"><h2 class="text-2xl font-bold">Today's chores</h2>
      {#each current.chores as chore (chore.id)}<article class="mt-4"><h3 class="text-lg font-semibold">{chore.title}</h3><p>{chore.status === 'verified' ? 'Approved' : chore.status === 'pending_verification' ? 'Waiting for a parent' : chore.status === 'needs_rework' ? 'Needs rework' : 'To do'}</p></article>{:else}<p class="mt-4">No shared chores today.</p>{/each}
      {#if current.chores.length}<p class="mt-4">{current.chores.filter(chore => chore.status === 'verified').length} of {current.chores.length} approved</p>{/if}
    </section>
    <section aria-label="Tonight's dinner" class="rounded-2xl bg-white p-6 shadow-sm"><h2 class="text-2xl font-bold">Tonight's dinner</h2>{#each current.meals as meal (meal.id)}<article class="mt-4"><h3 class="text-lg font-semibold">{meal.title}</h3>{#if meal.time}<p>{meal.time}</p>{/if}{#if meal.servings}<p>Serves {meal.servings}</p>{/if}{#if meal.ingredients}<p class="mt-3 whitespace-pre-line">{meal.ingredients}</p>{/if}{#if meal.source}<p class="mt-3">Source: {meal.source}</p>{/if}{#if meal.recipeUrl}<a href={meal.recipeUrl} rel="external noopener noreferrer" class="mt-3 inline-block text-teal-700">{recipeLinkLabel(meal.source)}</a>{/if}</article>{:else}<p class="mt-4">No meals shared for today.</p>{/each}</section>
  </div>
  <div class="mt-8 flex flex-wrap gap-3"><a href={resolve('/display')} data-sveltekit-reload class="inline-block rounded-xl border border-teal-700 px-4 py-3">Refresh display</a><button disabled={!ready} onclick={() => { updating = !updating; if (!updating) generation++; }} class="rounded-xl border border-teal-700 px-4 py-3 disabled:opacity-50">{updating ? 'Pause automatic updates' : 'Resume automatic updates'}</button>{#if current.canManage}<a href={resolve('/display/settings')} class="inline-block rounded-xl border border-teal-700 px-4 py-3">Choose what to share</a>{/if}</div>
</main>
