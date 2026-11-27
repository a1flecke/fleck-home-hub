<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';

  type Form = { message: string; conflict: boolean; draft: { name: string; description: string; targetDate: string; shared: boolean; revision: string; requestId: string } };
  let { data, form }: { data: PageData; form: Form | null } = $props();
  let description = $derived(form?.draft.description ?? data.preview?.description ?? '');
  let nameInput = $state<HTMLInputElement>();
  let hydrated = $state(false);

  onMount(() => {
    hydrated = true;
    if (form?.draft && document.activeElement === document.body) nameInput?.focus();
  });
</script>

<svelte:head><title>Make a fresh list · Family lists</title></svelte:head>
<main data-hydrated={hydrated} class="mx-auto max-w-3xl px-4 py-7 text-slate-900">
  {#if data.source.kind === 'template'}
    <a class="inline-flex min-h-11 items-center font-semibold text-teal-800 underline" href={resolve('/lists/templates')}>← List templates</a>
  {:else}
    <a class="inline-flex min-h-11 items-center font-semibold text-teal-800 underline" href={resolve('/lists')}>← Family lists</a>
  {/if}
  <h1 class="mt-2 text-3xl font-bold">Make a fresh list</h1>
  {#if form?.message}<p role="alert" class="mt-4 rounded-xl bg-amber-100 p-3">{form.message}</p>{/if}
  {#if form?.conflict && data.preview}
    <a class="inline-flex min-h-11 items-center font-semibold text-teal-800 underline" href={resolve('/lists/copy/[source]/[id]', { source: data.source.kind, id: data.source.id })} data-sveltekit-reload>Reload preview</a>
  {/if}
  {#if data.preview}
    <section aria-labelledby="copy-preview" class="mt-4 rounded-2xl bg-teal-50 p-4">
      <h2 id="copy-preview" class="text-xl font-bold">Preview</h2>
      <p class="mt-1 break-words font-semibold">{data.preview.name}</p>
      <p class="mt-1 text-sm">{data.preview.items.length} {data.preview.items.length === 1 ? 'item' : 'items'}. Every item starts unchecked.</p>
      {#if data.preview.items.length}
        <ol class="mt-3 list-decimal space-y-1 pl-6">
          {#each data.preview.items as item, index (index)}<li class="break-words">{item}</li>{/each}
        </ol>
      {/if}
    </section>
  {:else}
    <p class="mt-2">This source is no longer available.</p>
  {/if}
  {#if data.preview || form?.draft}
    <form method="POST" action="?/create" aria-label="Create a fresh list" class="mt-4 grid gap-3 rounded-2xl bg-white p-4 shadow-sm">
      <input type="hidden" name="revision" value={form?.draft.revision ?? data.preview?.revision} />
      <input type="hidden" name="requestId" value={form?.draft.requestId ?? data.requestId} />
      <label>List name
        <input bind:this={nameInput} name="name" required maxlength="120" defaultValue={form?.draft.name ?? data.preview?.name ?? ''} class="mt-1 block w-full rounded-lg border p-3" />
      </label>
      <label>Description (optional)
        <textarea name="description" maxlength="1000" rows="2" bind:value={description} class="mt-1 block w-full rounded-lg border p-3"></textarea>
      </label>
      <label>Target date (optional)
        <input name="targetDate" type="date" defaultValue={form?.draft.targetDate ?? ''} class="mt-1 block w-full rounded-lg border p-3" />
      </label>
      <label class="flex min-h-11 items-center gap-3">
        <input class="h-5 w-5" type="checkbox" name="shared" value="yes" defaultChecked={form?.draft.shared ?? false} /> Share with family
      </label>
      <p class="text-sm">Your new list is private to parents unless you share it.</p>
      <button disabled={!data.preview} class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white disabled:bg-slate-500">Create list</button>
    </form>
  {/if}
</main>
