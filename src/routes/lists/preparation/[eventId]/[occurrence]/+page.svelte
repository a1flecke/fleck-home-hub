<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { viewHeading } from '../../../../../lib/calendar/navigation';
  import type { PageData } from './$types';

  type Form = { draft?: { name: string; description: string; shared: boolean; requestId: string }; createError?: string; selected?: string; attachError?: string };
  let { data, form }: { data: PageData; form: Form | null } = $props();
  let description = $derived(form?.draft?.description ?? '');
  let calendarQuery = $derived(`date=${data.calendar.date}&view=${data.calendar.view}`);
  let nameField = $state<HTMLInputElement>();
  let checklistField = $state<HTMLSelectElement>();
  let hydrated = $state(false);

  onMount(() => {
    hydrated = true;
    if (document.activeElement === document.body) {
      if (form?.createError) nameField?.focus();
      if (form?.attachError) checklistField?.focus();
    }
  });
</script>

<svelte:head><title>Event preparation · Family lists</title></svelte:head>
<main data-hydrated={hydrated} class="mx-auto max-w-3xl px-4 py-7 text-slate-900">
  <a class="inline-flex min-h-11 items-center font-semibold text-teal-800 underline" href={resolve(`/calendar?${calendarQuery}`)}>← Back to calendar</a>
  <h1 class="mt-2 text-3xl font-bold">Event preparation</h1>
  {#if data.event}
    <p class="mt-2 break-words font-semibold">{data.event.title} · {viewHeading(data.occurrence, 'day')}</p>
    {#if data.event.checklists.length}
      <ul aria-label="Linked checklists" class="mt-3 rounded-xl bg-teal-50 p-4">
        {#each data.event.checklists as list (list.id)}
          <li class="flex flex-wrap items-center gap-x-3 py-1">
            <a class="min-h-8 break-words font-semibold text-teal-800 underline" href={resolve('/lists/[id]', { id: list.id })}>{list.name}</a>
            <span class="text-sm">{list.completed} of {list.total} items ready</span>
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <p class="mt-2">This event date is no longer available.</p>
  {/if}

  {#if data.event || form?.createError}
    <section id="add" class="mt-4 rounded-2xl bg-white p-4 shadow-sm">
      <h2 class="text-xl font-bold">Add preparation checklist</h2>
      {#if form?.createError}<p role="alert" class="mt-2 rounded-xl bg-amber-100 p-3">{form.createError}</p>{/if}
      <form method="POST" action={`?/create&${calendarQuery}`} aria-label="Add preparation checklist" class="mt-3 grid gap-3">
        <input type="hidden" name="requestId" value={form?.draft?.requestId ?? data.requestId} />
        <label>List name
          <input bind:this={nameField} name="name" required maxlength="120" defaultValue={form?.draft?.name ?? ''} class="mt-1 block w-full rounded-lg border p-3" />
        </label>
        <label>Description (optional)
          <textarea name="description" rows="2" maxlength="1000" bind:value={description} class="mt-1 block w-full rounded-lg border p-3"></textarea>
        </label>
        <label class="flex min-h-11 items-center gap-3">
          <input type="checkbox" name="shared" value="yes" defaultChecked={form?.draft?.shared ?? false} class="h-5 w-5" /> Share with family
        </label>
        <button disabled={!data.event} class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white disabled:bg-slate-500">Create checklist</button>
      </form>
    </section>
  {/if}
  {#if data.event || form?.attachError}
    <section id="attach" class="mt-4 rounded-2xl bg-white p-4 shadow-sm">
      <h2 class="text-xl font-bold">Attach existing checklist</h2>
      {#if form?.attachError}<p role="alert" class="mt-2 rounded-xl bg-amber-100 p-3">{form.attachError}</p>{/if}
      {#if !data.choices.length}
        <p class="mt-2">There are no unlinked lists to attach. Create one here or open a list to move its calendar link.</p>
      {/if}
      {#if data.choices.length || form?.selected}
        <form method="POST" action={`?/attach&${calendarQuery}`} aria-label="Attach existing checklist" class="mt-3 grid gap-3">
          <label>Checklist
            <select bind:this={checklistField} name="checklist" required class="mt-1 block w-full rounded-lg border p-3">
              <option value="" selected={!form?.selected}>Choose a checklist</option>
              {#if form?.selected && !data.choices.some(list => list.id === form?.selected)}
                <option value={form.selected} selected>Previously selected checklist</option>
              {/if}
              {#each data.choices as list (list.id)}
                <option value={list.id} selected={list.id === form?.selected}>{list.name} ({list.shared ? 'shared' : 'parents only'})</option>
              {/each}
            </select>
          </label>
          <button disabled={!data.choices.length} class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white disabled:bg-slate-500">Attach checklist</button>
        </form>
      {/if}
    </section>
  {/if}
</main>
