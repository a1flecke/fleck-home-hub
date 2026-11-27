<script lang="ts">
  import { resolve } from '$app/paths';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>List templates · Family lists</title></svelte:head>
<main class="mx-auto max-w-3xl px-4 py-7 text-slate-900">
  <a class="inline-flex min-h-11 items-center font-semibold text-teal-800 underline" href={resolve('/lists')}>← Family lists</a>
  <h1 class="mt-2 text-3xl font-bold">List templates</h1>
  {#if !data.templates.length}
    <section class="mt-4 rounded-2xl bg-white p-5 shadow-sm">
      <h2 class="text-lg font-bold">No templates yet</h2>
      <p class="mt-2">Open a packing or preparation list and choose <strong>Save as template</strong> to use its items again.</p>
      <a class="mt-3 inline-flex min-h-11 items-center font-bold text-teal-800 underline" href={resolve('/lists')}>Browse family lists</a>
    </section>
  {:else}
    <p class="mt-2">Pick a template to start a fresh checklist.</p>
    {#each data.templates as template (template.id)}
      <article aria-label={template.name} class="mt-4 rounded-2xl bg-white p-4 shadow-sm">
        <h2 class="break-words text-xl font-bold">{template.name}</h2>
        <p class="mt-1 text-sm text-slate-700">{template.itemCount} {template.itemCount === 1 ? 'item' : 'items'}</p>
        {#if template.description}<p class="mt-2 whitespace-pre-wrap break-words">{template.description}</p>{/if}
        <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
          <a class="inline-flex min-h-11 items-center rounded-xl bg-teal-700 px-4 font-bold text-white" href={resolve('/lists/copy/[source]/[id]', { source: 'template', id: template.id })}>Use this template</a>
          <a class="inline-flex min-h-11 items-center font-semibold text-teal-800 underline" href={resolve('/lists/templates/[id]', { id: template.id })}>Edit template</a>
        </div>
      </article>
    {/each}
  {/if}
</main>
