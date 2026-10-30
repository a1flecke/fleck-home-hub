<script lang="ts">
  import { resolve } from '$app/paths';
  let { data } = $props();
</script>
<svelte:head><title>Family display · Fleck Home Hub</title><meta http-equiv="refresh" content="60" /></svelte:head>
<main class="mx-auto max-w-7xl px-5 py-8">
  <a href={resolve('/dashboard')} class="text-teal-700">Back to My Day</a>
  <h1 class="mt-5 text-4xl font-bold">Family display</h1>
  <p class="mt-2 text-lg">{data.today} · {data.timezone}</p>
  <div class="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
    <section aria-label="Today's events" class="rounded-2xl bg-white p-6 shadow-sm"><h2 class="text-2xl font-bold">Today's events</h2>
      {#each data.events.filter(event => event.date === data.today) as event (`${event.id}-${event.date}`)}<article class="mt-4"><h3 class="text-lg font-semibold">{event.title}</h3><p>{event.allDay ? 'All day' : `${event.startTime}–${event.endTime}`}</p></article>{:else}<p class="mt-4">No shared events today.</p>{/each}
    </section>
    <section aria-label="Upcoming events" class="rounded-2xl bg-white p-6 shadow-sm"><h2 class="text-2xl font-bold">Coming up</h2>
      {#each data.events.filter(event => event.date > data.today) as event (`${event.id}-${event.date}`)}<article class="mt-4"><h3 class="text-lg font-semibold">{event.title}</h3><p>{event.date} · {event.allDay ? 'All day' : `${event.startTime}–${event.endTime}`}</p></article>{:else}<p class="mt-4">No shared events coming up.</p>{/each}
    </section>
    <section aria-label="Shared chores" class="rounded-2xl bg-white p-6 shadow-sm"><h2 class="text-2xl font-bold">Today's chores</h2>
      {#each data.chores as chore (chore.id)}<article class="mt-4"><h3 class="text-lg font-semibold">{chore.title}</h3><p>{chore.status === 'verified' ? 'Approved' : chore.status === 'pending_verification' ? 'Waiting for a parent' : chore.status === 'needs_rework' ? 'Needs rework' : 'To do'}</p></article>{:else}<p class="mt-4">No shared chores today.</p>{/each}
      {#if data.chores.length}<p class="mt-4">{data.chores.filter(chore => chore.status === 'verified').length} of {data.chores.length} approved</p>{/if}
    </section>
    <section class="rounded-2xl bg-white p-6 shadow-sm"><h2 class="text-2xl font-bold">Tonight's dinner</h2><p class="mt-4">Meal planning is coming soon.</p></section>
  </div>
  {#if data.canManage}<a href={resolve('/display/settings')} class="mt-8 inline-block rounded-xl border border-teal-700 px-4 py-3">Choose what to share</a>{/if}
</main>
