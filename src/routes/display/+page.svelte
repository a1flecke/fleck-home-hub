<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  let { data } = $props();
  let current = $derived(data);
  let ready = $state(false);
  let updating = $state(true);
  let refreshError = $state(false);
  onMount(() => {
    ready = true;
    let inFlight = false;
    const timer = setInterval(() => {
      if (updating && !inFlight) {
        inFlight = true;
        void fetch(resolve('/display/data'), { cache: 'no-store' }).then(async response => {
        if (response.redirected || response.status === 401 || response.status === 403) { window.location.assign(resolve('/sign-in')); return; }
        if (!response.ok) throw new Error('Display refresh failed');
        current = await response.json();
        refreshError = false;
        }).catch(() => { refreshError = true; }).finally(() => { inFlight = false; });
      }
    }, 60_000);
    return () => clearInterval(timer);
  });
</script>
<svelte:head><title>Family display · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-7xl px-5 py-8">
  <a href={resolve('/dashboard')} class="text-teal-700">Back to My Day</a>
  <h1 class="mt-5 text-4xl font-bold">Family display</h1>
  <p class="mt-2 text-lg">{current.today} · {current.timezone}</p>
  {#if refreshError}<p role="status" class="mt-3">Unable to update the display. Check the connection and refresh.</p>{/if}
  <div class="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
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
    <section class="rounded-2xl bg-white p-6 shadow-sm"><h2 class="text-2xl font-bold">Tonight's dinner</h2><p class="mt-4">Meal planning is coming soon.</p></section>
  </div>
  <div class="mt-8 flex flex-wrap gap-3"><a href={resolve('/display')} data-sveltekit-reload class="inline-block rounded-xl border border-teal-700 px-4 py-3">Refresh display</a><button disabled={!ready} onclick={() => { updating = !updating; }} class="rounded-xl border border-teal-700 px-4 py-3 disabled:opacity-50">{updating ? 'Pause automatic updates' : 'Resume automatic updates'}</button>{#if current.canManage}<a href={resolve('/display/settings')} class="inline-block rounded-xl border border-teal-700 px-4 py-3">Choose what to share</a>{/if}</div>
</main>
