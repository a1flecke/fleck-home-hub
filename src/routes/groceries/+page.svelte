<script lang="ts">
  import { resolve } from '$app/paths';
  import Disclosure from '../calendar/Disclosure.svelte';
  import GroceryFields from './GroceryFields.svelte';
  import type { PageData } from './$types';
  type Input = { name: string; quantity: string; unit: string };
  let { data, form }: { data: PageData; form: { message: string; item?: Input; duplicate?: boolean; edit?: Input & { id: string; version: number; completed: boolean } } | null } = $props();
</script>
<svelte:head><title>Groceries · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-3xl px-5 py-8">
  <a href={resolve('/dashboard')} class="text-teal-700">Back to home</a>
  <h1 class="mt-5 text-3xl font-bold">Grocery list</h1>
  <p class="mt-2">A shared list for your household.</p>
  {#if form?.message}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4">{form.message}</p>{/if}
  <form method="POST" action="?/add" aria-label="Add grocery item" class="mt-6 grid gap-3 rounded-2xl bg-white p-5 shadow-sm">
    <GroceryFields initial={form?.item ?? { name: '', quantity: '', unit: '' }} />
    {#if form?.duplicate}<label><input type="checkbox" name="allowDuplicate" value="yes" required /> Add another anyway</label>{/if}
    <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Add item</button>
  </form>
  <section aria-label="Grocery items" class="mt-6"><h2 class="text-2xl font-bold">Your list</h2>
    {#each data.items as item (item.id)}
      <article class="mt-4 rounded-2xl bg-white p-5 shadow-sm">
        <h3 class="text-xl font-bold">{item.name}</h3>
        {#if item.quantity || item.unit}<p>{item.quantity} {item.unit}</p>{/if}
        <p>{item.completed ? 'Bought' : 'To buy'}</p>
        <form method="POST" action="?/change" class="mt-3">
          <input type="hidden" name="id" value={item.id} /><input type="hidden" name="version" value={item.version} />
          <input type="hidden" name="name" value={item.name} /><input type="hidden" name="quantity" value={item.quantity} /><input type="hidden" name="unit" value={item.unit} />
          <input type="hidden" name="completed" value={item.completed ? 'no' : 'yes'} />
          <button class="rounded-xl border border-teal-700 px-4 py-3">{item.completed ? 'Mark to buy' : 'Mark bought'}</button>
        </form>
        <Disclosure class="mt-3" expanded={form?.edit?.id === item.id}><summary class="cursor-pointer font-bold">Edit item</summary>
          <form method="POST" action="?/change" aria-label={`Edit ${item.name}`} class="mt-3 grid gap-3">
            <input type="hidden" name="id" value={item.id} /><input type="hidden" name="version" value={form?.edit?.id === item.id ? form.edit.version : item.version} /><input type="hidden" name="completed" value={(form?.edit?.id === item.id ? form.edit.completed : item.completed) ? 'yes' : 'no'} />
            <GroceryFields initial={form?.edit?.id === item.id ? form.edit : item} />
            <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Save item</button>
          </form>
        </Disclosure>
        <form method="POST" action="?/remove" class="mt-3"><input type="hidden" name="id" value={item.id} /><input type="hidden" name="version" value={item.version} /><button class="rounded-xl border border-teal-700 px-4 py-3">Remove item</button></form>
      </article>
    {:else}<p class="mt-4">Your grocery list is empty.</p>{/each}
  </section>
</main>
