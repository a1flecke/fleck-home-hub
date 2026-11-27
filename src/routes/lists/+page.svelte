<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';
  type FormResult = { message: string; requestId?: string; input?: { name: string; description: string; targetDate: string; shared: boolean } };
  let { data, form }: { data: PageData; form: FormResult | null } = $props();
  let recoveredName = $state<HTMLInputElement>();
  onMount(() => {
    if (recoveredName?.hasAttribute('data-recovery-focus') && document.activeElement === document.body) recoveredName.focus();
  });
  let description = $derived(form?.input?.description ?? '');
</script>
<svelte:head><title>Family lists</title></svelte:head>
<main class="mx-auto max-w-3xl px-4 py-8 text-slate-900">
  <a href={resolve('/dashboard')} class="text-teal-800 underline">My Day</a>
  <h1 class="mt-4 text-3xl font-bold">Family lists</h1>
  <p class="mt-2">Keep track of the things your family needs to do.</p>
  {#if form?.message}<p role="alert" class="mt-4 rounded-xl bg-amber-100 p-3">{form.message}</p>{/if}
  {#if data.role === 'parent'}
    <section class="mt-6 rounded-2xl bg-white p-5 shadow-sm">
      <h2 class="text-xl font-bold">Create a list</h2>
      <a class="inline-flex min-h-11 items-center font-semibold text-teal-800 underline" href={resolve('/lists/templates')}>Choose a template</a>
      <form method="POST" action="?/create" aria-label="Create a family list" class="mt-4 grid gap-3">
        <input type="hidden" name="requestId" value={form?.requestId || data.requestId} />
        <label>List name<input bind:this={recoveredName} data-recovery-focus={form?.input ? '': undefined} name="name" required maxlength="120" defaultValue={form?.input?.name ?? ''} class="mt-1 block w-full rounded-lg border p-3" /></label>
        <label>Description (optional)<textarea name="description" maxlength="1000" bind:value={description} class="mt-1 block w-full rounded-lg border p-3"></textarea></label>
        <label>Target date (optional)<input name="targetDate" type="date" defaultValue={form?.input?.targetDate ?? ''} class="mt-1 block w-full rounded-lg border p-3" /></label>
        <label class="flex min-h-11 items-center gap-3"><input class="h-5 w-5" type="checkbox" name="shared" value="yes" defaultChecked={form?.input?.shared ?? false} /> Share with family</label>
        <p class="text-sm">Lists are private to parents unless shared.</p>
        <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Create list</button>
      </form>
    </section>
  {/if}
  <section class="mt-6"><h2 class="text-xl font-bold">Your lists</h2>
    {#if data.lists.length === 0}<p class="mt-3">No lists yet.</p>{/if}
    {#each data.lists as list (list.id)}
      <article class="mt-3 rounded-2xl bg-white p-5 shadow-sm"><h3 class="font-bold"><a class="text-teal-800 underline" href={resolve('/lists/[id]', { id: list.id })}>{list.name}</a></h3><p>{list.archived ? 'Archived · ' : ''}{list.shared ? 'Shared with family' : 'Parents only'}{list.targetDate ? ` · ${list.targetDate}` : ''}</p></article>
    {/each}
  </section>
</main>
