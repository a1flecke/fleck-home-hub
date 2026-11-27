<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import Disclosure from '../../calendar/Disclosure.svelte';
  import ItemRow from './ItemRow.svelte';
  import type { PageData } from './$types';

  type FormResult = {
    message: string;
    addText?: string;
    addRequestId?: string;
    editList?: { name: string; description: string; targetDate: string; shared: boolean; archived: boolean; version: number };
    editItem?: { id: string; name: string; version: number };
  };

  let { data, form }: { data: PageData; form: FormResult | null } = $props();
  let ready = $derived(data.list.items.filter(item => item.completed));
  let todo = $derived(data.list.items.filter(item => !item.completed));
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
    <p class="mt-4 font-bold">{ready.length} of {data.list.items.length} items ready</p>
    <p class="text-sm">{todo.length} still to do</p>
    {#if data.list.items.length}
      <progress aria-label="Checklist progress" value={ready.length} max={data.list.items.length} class="mt-2 h-2 w-full accent-teal-700"></progress>
    {/if}
  </header>
  {#if form?.message}<p role="alert" class="mt-4 rounded-xl bg-amber-100 p-3">{form.message}</p>{/if}

  {#if data.role === 'parent'}
    <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
      <a class="inline-flex min-h-11 items-center font-semibold text-teal-800 underline" href={resolve('/lists/copy/[source]/[id]', { source: 'list', id: data.list.id })}>Use this list again</a>
      <form method="POST" action="?/saveTemplate">
        <button class="min-h-11 rounded-xl border border-teal-800 px-3 py-2 font-bold text-teal-800">Save as template</button>
      </form>
    </div>
    {#if !data.list.archived}
      <section class="mt-4 rounded-2xl bg-white p-4 shadow-sm">
        <h2 class="text-lg font-bold">Add things to do</h2>
        <form method="POST" action="?/add" aria-label="Add things to do" class="mt-3 grid gap-3">
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
      <form method="POST" action="?/update" aria-label="Edit list details" class="mt-2 grid gap-3">
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

  <section class="mt-4 rounded-2xl bg-white p-4 shadow-sm" aria-labelledby="still-to-do">
    <h2 id="still-to-do" class="text-xl font-bold">Still to do</h2>
    {#if todo.length === 0}<p class="mt-2">{ready.length ? 'Everything is ready!' : 'No items yet.'}</p>{/if}
    {#each todo as item (item.id)}
      <ItemRow {item} editable={data.role === 'parent'} archived={data.list.archived} draft={form?.editItem?.id === item.id ? form.editItem : undefined} />
    {/each}
  </section>
  <Disclosure class="mt-4 rounded-2xl bg-white p-4 shadow-sm" expanded={ready.some(item => item.id === form?.editItem?.id)}>
    <summary class="min-h-11 cursor-pointer py-2 text-xl font-bold">Done ({ready.length})</summary>
    {#each ready as item (item.id)}
      <ItemRow {item} editable={data.role === 'parent'} archived={data.list.archived} draft={form?.editItem?.id === item.id ? form.editItem : undefined} />
    {:else}
      <p class="mt-2">Ready items will appear here.</p>
    {/each}
  </Disclosure>
</main>
