<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { checklistFilters, matchesChecklistFilter } from '../../../lib/checklists/readiness';
  import { viewHeading } from '../../../lib/calendar/navigation';
  import Disclosure from '../../calendar/Disclosure.svelte';
  import ItemRow from './ItemRow.svelte';
  import type { PageData } from './$types';

  type FormResult = {
    message: string;
    addText?: string;
    addRequestId?: string;
    editList?: { name: string; description: string; targetDate: string; shared: boolean; archived: boolean; version: number };
    editItem?: { id: string; name: string; version: number; assignedTo?: string | null };
  };

  let { data, form }: { data: PageData; form: FormResult | null } = $props();
  let readyCount = $derived(data.list.items.filter(item => item.completed).length);
  let visibleItems = $derived(data.list.items.filter(item => item.id === form?.editItem?.id || matchesChecklistFilter(data.filter, item)));
  let ready = $derived(visibleItems.filter(item => item.completed));
  let todo = $derived(visibleItems.filter(item => !item.completed));
  const listAction = (name: string) => data.filter === 'all' ? `?/${name}` : `?/${name}&items=${data.filter}`;
  let description = $derived(form?.editList?.description ?? data.list.description ?? '');
  let addText = $derived(form?.addText ?? '');
  let main: HTMLElement;
  let hydrated = $state(false);

  onMount(() => {
    hydrated = true;
    if (document.activeElement === document.body) main.querySelector<HTMLElement>('[data-recovery-focus]')?.focus();
  });
</script>

<svelte:head><title>{data.list.name} · Family lists</title></svelte:head>
<main bind:this={main} data-hydrated={hydrated} class="mx-auto max-w-3xl px-4 py-7 text-slate-900">
  <a class="inline-flex min-h-11 items-center font-semibold text-teal-800 underline" href={resolve('/lists')}>← Family lists</a>
  <header class="mt-2 rounded-2xl bg-teal-50 p-5">
    <h1 class="break-words text-3xl font-bold">{data.list.name}</h1>
    {#if data.list.description}<p class="mt-2 whitespace-pre-wrap break-words">{data.list.description}</p>{/if}
    <p class="mt-2 text-sm text-slate-700">
      {data.list.shared ? 'Shared with family' : 'Parents only'}{data.list.targetDate ? ' · ' + data.list.targetDate : ''}{data.list.archived ? ' · Archived' : ''}
    </p>
    <p class="mt-4 font-bold">{readyCount} of {data.list.items.length} items ready</p>
    <p class="text-sm">{data.list.items.length - readyCount} still to do</p>
    {#if data.list.items.length}
      <progress aria-label="Checklist progress" value={readyCount} max={data.list.items.length} class="mt-2 h-2 w-full accent-teal-700"></progress>
    {/if}
  </header>
  {#if form?.message}<p role="alert" class="mt-4 rounded-xl bg-amber-100 p-3">{form.message}</p>{/if}

  {#if data.role === 'parent'}
    <section aria-label="Calendar event" class="mt-4 rounded-xl bg-teal-50 p-4">
      <p class="font-bold text-teal-950">Calendar event</p>
      {#if data.eventLink}
        <p class="mt-1 break-words">{data.eventLink.title} · {viewHeading(data.eventLink.date, 'day')}</p>
        {#if data.eventLink.stale}
          <p class="mt-1 text-sm">This date was cancelled or moved. Your checklist is still here.</p>
        {:else}
          <a class="inline-flex min-h-11 items-center font-semibold text-teal-800 underline" href={resolve(`/calendar?date=${data.eventLink.date}&view=day`)}>Open in calendar</a>
        {/if}
      {/if}
      {#if !data.list.archived || data.eventLink}
        <a class="inline-flex min-h-11 items-center font-semibold text-teal-800 underline" href={resolve('/lists/[id]/event', { id: data.list.id })}>{data.eventLink ? 'Change or remove calendar link' : 'Link to calendar event'}</a>
      {/if}
    </section>
    <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
      <a class="inline-flex min-h-11 items-center font-semibold text-teal-800 underline" href={resolve('/lists/copy/[source]/[id]', { source: 'list', id: data.list.id })}>Use this list again</a>
      <form method="POST" action={listAction('saveTemplate')}>
        <button class="min-h-11 rounded-xl border border-teal-800 px-3 py-2 font-bold text-teal-800">Save as template</button>
      </form>
    </div>
    {#if !data.list.archived}
      <section class="mt-4 rounded-2xl bg-white p-4 shadow-sm">
        <h2 class="text-lg font-bold">Add things to do</h2>
        <form method="POST" action={listAction('add')} aria-label="Add things to do" class="mt-3 grid gap-3">
          <input type="hidden" name="requestId" value={form?.addRequestId || data.addRequestId} />
          <label>
            Things to add
            <textarea name="text" required maxlength="12000" rows="2" bind:value={addText} placeholder="Add one item or paste several, one per line" data-recovery-focus={form?.addText !== undefined ? '' : undefined} class="mt-1 block w-full rounded-lg border p-3"></textarea>
          </label>
          <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Add items</button>
        </form>
      </section>
    {/if}
    <Disclosure class="mt-4 rounded-2xl bg-white p-4 shadow-sm" expanded={!!form?.editList}>
      <summary class="min-h-11 cursor-pointer py-2 font-bold">List details</summary>
      <form method="POST" action={listAction('update')} aria-label="Edit list details" class="mt-2 grid gap-3">
        <input type="hidden" name="version" value={form?.editList?.version ?? data.list.version} />
        <label>
          List name
          <input name="name" required maxlength="120" defaultValue={form?.editList?.name ?? data.list.name} data-recovery-focus={form?.editList ? '' : undefined} class="mt-1 block w-full rounded-lg border p-3" />
        </label>
        <label>
          Description (optional)
          <textarea name="description" maxlength="1000" rows="2" bind:value={description} class="mt-1 block w-full rounded-lg border p-3"></textarea>
        </label>
        <label>
          Target date (optional)
          <input name="targetDate" type="date" defaultValue={form?.editList?.targetDate ?? data.list.targetDate ?? ''} class="mt-1 block w-full rounded-lg border p-3" />
        </label>
        <label class="flex min-h-11 items-center gap-3">
          <input type="checkbox" name="shared" value="yes" defaultChecked={form?.editList?.shared ?? data.list.shared} class="h-5 w-5" />
          Share with family
        </label>
        <label class="flex min-h-11 items-center gap-3">
          <input type="checkbox" name="archived" value="yes" defaultChecked={form?.editList?.archived ?? data.list.archived} class="h-5 w-5" />
          Archive this list
        </label>
        <button class="rounded-xl border border-teal-700 px-4 py-3 font-semibold">Save list details</button>
      </form>
    </Disclosure>
  {/if}

  <nav aria-label="Filter items" class="mt-5 flex flex-wrap gap-2">
    {#each checklistFilters as [filter, label] (filter)}
      <a href={resolve(filter === 'all' ? '/lists/[id]' : `/lists/[id]?items=${filter}`, { id: data.list.id })}
        aria-current={data.filter === filter ? 'page' : undefined}
        class="inline-flex min-h-11 items-center rounded-full border border-teal-700 px-3 text-sm font-semibold {data.filter === filter ? 'bg-teal-700 text-white' : 'text-teal-800'}">{label}</a>
    {/each}
  </nav>
  {#if data.filter !== 'completed' || todo.length > 0}
  <section class="mt-4 rounded-2xl bg-white p-4 shadow-sm" aria-labelledby="still-to-do">
    <h2 id="still-to-do" class="text-xl font-bold">Still to do</h2>
    {#if todo.length === 0}<p class="mt-2">{data.list.items.length === 0 ? 'No items yet.' : readyCount === data.list.items.length ? 'Everything is ready!' : 'No outstanding items match this filter.'}</p>{/if}
    {#each todo as item (item.id)}
      <ItemRow {item} editable={data.role === 'parent'} archived={data.list.archived} assignees={data.assignees} action={listAction} draft={form?.editItem?.id === item.id ? form.editItem : undefined} />
    {/each}
  </section>
  {/if}
  {#if data.filter !== 'todo' || ready.length > 0}
  <Disclosure class="mt-4 rounded-2xl bg-white p-4 shadow-sm" expanded={data.filter === 'completed' || ready.some(item => item.id === form?.editItem?.id)}>
    <summary class="min-h-11 cursor-pointer py-2 text-xl font-bold">Done ({ready.length})</summary>
    {#each ready as item (item.id)}
      <ItemRow {item} editable={data.role === 'parent'} archived={data.list.archived} assignees={data.assignees} action={listAction} draft={form?.editItem?.id === item.id ? form.editItem : undefined} />
    {:else}
      <p class="mt-2">Ready items will appear here.</p>
    {/each}
  </Disclosure>
  {/if}
</main>
