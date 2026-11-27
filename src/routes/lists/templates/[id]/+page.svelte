<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import Disclosure from '../../../calendar/Disclosure.svelte';
  import type { PageData } from './$types';

  type Form = { message: string; conflict?: boolean; removeVersion?: number; draft?: { name: string; description: string; items: string; version: number } };
  let { data, form }: { data: PageData; form: Form | null } = $props();
  let description = $derived(form?.draft?.description ?? data.template?.description ?? '');
  let items = $derived(form?.draft?.items ?? data.template?.items.join('\n') ?? '');
  let nameInput = $state<HTMLInputElement>();
  let hydrated = $state(false);

  onMount(() => {
    hydrated = true;
    if (form?.draft && document.activeElement === document.body) nameInput?.focus();
  });
</script>

<svelte:head><title>Edit template · Family lists</title></svelte:head>
<main data-hydrated={hydrated} class="mx-auto max-w-3xl px-4 py-7 text-slate-900">
  <a class="inline-flex min-h-11 items-center font-semibold text-teal-800 underline" href={resolve('/lists/templates')}>← List templates</a>
  <h1 class="mt-2 text-3xl font-bold">{data.template || form?.draft ? 'Edit template' : 'Template unavailable'}</h1>
  {#if form?.message}<p role="alert" class="mt-4 rounded-xl bg-amber-100 p-3">{form.message}</p>{/if}
  {#if form?.conflict && data.template}
    <a class="inline-flex min-h-11 items-center font-semibold text-teal-800 underline" href={resolve('/lists/templates/[id]', { id: data.template.id })} data-sveltekit-reload>Reload template</a>
  {/if}
  {#if !data.template && !form?.draft}
    <p class="mt-2">This template is no longer available. Choose another from your list templates.</p>
  {/if}
  {#if data.template || form?.draft}
    <form method="POST" action="?/update" aria-label="Edit template" class="mt-4 grid gap-4 rounded-2xl bg-white p-4 shadow-sm">
      <input type="hidden" name="version" value={form?.draft?.version ?? data.template?.version} />
      <label>Template name
        <input bind:this={nameInput} name="name" required maxlength="120" defaultValue={form?.draft?.name ?? data.template?.name ?? ''} class="mt-1 block w-full rounded-lg border p-3" />
      </label>
      <label>Description (optional)
        <textarea name="description" maxlength="1000" rows="2" bind:value={description} class="mt-1 block w-full rounded-lg border p-3"></textarea>
      </label>
      <label>Items, one per line
        <textarea name="items" maxlength="61000" rows="8" bind:value={items} class="mt-1 block w-full rounded-lg border p-3"></textarea>
      </label>
      <button disabled={!data.template} class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white disabled:bg-slate-500">Save template</button>
    </form>
  {/if}
  {#if data.template}
    <a class="mt-3 inline-flex min-h-11 items-center font-semibold text-teal-800 underline" href={resolve('/lists/copy/[source]/[id]', { source: 'template', id: data.template.id })}>Use this template</a>
    <Disclosure class="mt-4 rounded-2xl bg-white p-4 shadow-sm" expanded={form?.removeVersion !== undefined}>
      <summary class="min-h-11 cursor-pointer py-2 font-bold">Remove template</summary>
      <p class="mt-1 text-sm">Lists you already made from this template will stay in Family lists.</p>
      <form method="POST" action="?/remove" aria-label="Remove template" class="mt-3">
        <input type="hidden" name="version" value={form?.removeVersion ?? data.template.version} />
        <button class="min-h-11 rounded-xl border border-red-300 px-4 py-2 font-bold text-red-800">Remove this template</button>
      </form>
    </Disclosure>
  {/if}
</main>
