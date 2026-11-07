<script lang="ts">
  import { refreshAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import Disclosure from '../calendar/Disclosure.svelte';
  import { GROCERY_REFRESH_INTERVAL_MS, groceryAddDraftExists, groceryDraftIsDirty } from '../../lib/grocery/live-update';
  import GroceryFields from './GroceryFields.svelte';
  import type { PageData } from './$types';
  type Input = { name: string; quantity: string; unit: string };
  type Item = PageData['items'][number];
  let { data, form }: { data: PageData; form: { message: string; item?: Input; duplicate?: boolean; edit?: Input & { id: string; version: number; completed: boolean } } | null } = $props();

  let ready = $state(false);
  let refreshFailed = $state(false);
  let addDirty = $state(false);
  let dirtyEdits = $state<string[]>([]);
  let autoPaused = $state(false);
  let manualNotice = $state('');
  let editRounds = $state<Record<string, number>>({});
  let editingPaused = $derived(addDirty || dirtyEdits.length > 0);
  let inFlight = false;
  let disposed = false;

  function draft(formElement: HTMLFormElement) {
    const values = new FormData(formElement);
    return {
      name: String(values.get('name') ?? ''),
      quantity: String(values.get('quantity') ?? ''),
      unit: String(values.get('unit') ?? '')
    };
  }

  function addFormChanged(event: Event) {
    const formElement = event.currentTarget as HTMLFormElement;
    const values = new FormData(formElement);
    addDirty = groceryAddDraftExists({ ...draft(formElement), allowDuplicate: values.get('allowDuplicate') === 'yes' });
    manualNotice = '';
  }

  function editFormChanged(event: Event, item: Item) {
    const dirty = groceryDraftIsDirty(draft(event.currentTarget as HTMLFormElement), item);
    dirtyEdits = dirty ? [...new Set([...dirtyEdits, item.id])] : dirtyEdits.filter(id => id !== item.id);
    manualNotice = '';
  }

  function handleToggle(event: Event) {
    const target = event.target;
    if (!(target instanceof HTMLDetailsElement) || target.open) return;
    const formElement = target.querySelector<HTMLFormElement>('form[data-grocery-edit]');
    const id = formElement ? String(new FormData(formElement).get('id') ?? '') : '';
    if (!id) return;
    dirtyEdits = dirtyEdits.filter(value => value !== id);
    editRounds = { ...editRounds, [id]: (editRounds[id] ?? 0) + 1 };
    manualNotice = '';
  }

  function manualRefresh(event: MouseEvent) {
    if (!ready) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void runRefresh(true);
  }

  function toggleAutoPaused() {
    autoPaused = !autoPaused;
    manualNotice = '';
    if (!autoPaused && document.visibilityState === 'visible') void runRefresh();
  }

  async function runRefresh(manual = false) {
    if (disposed) return;
    if (editingPaused) {
      if (manual) manualNotice = 'Finish or clear your changes before refreshing.';
      return;
    }
    if (!navigator.onLine) {
      if (manual) manualNotice = 'You appear to be offline. The list will update when the connection returns.';
      else refreshFailed = true;
      return;
    }
    if (inFlight) return;
    inFlight = true;
    if (manual) manualNotice = '';
    try {
      await refreshAll();
      if (!disposed) { refreshFailed = false; manualNotice = ''; }
    } catch {
      if (!disposed) refreshFailed = true;
    } finally {
      inFlight = false;
    }
  }

  onMount(() => {
    ready = true;
    disposed = false;
    const failedForm = form;
    if (failedForm?.item || failedForm?.duplicate) {
      addDirty = groceryAddDraftExists({
        ...(failedForm.item ?? { name: '', quantity: '', unit: '' }),
        allowDuplicate: Boolean(failedForm.duplicate)
      });
    }
    if (failedForm?.edit) {
      const saved = data.items.find(item => item.id === failedForm.edit?.id);
      if (saved && groceryDraftIsDirty(failedForm.edit, saved)) dirtyEdits = [saved.id];
    }

    const tick = () => {
      if (document.visibilityState !== 'visible' || autoPaused) return;
      void runRefresh();
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') tick(); };
    const onOffline = () => { if (!disposed) refreshFailed = true; };
    const onOnline = () => { if (!disposed && document.visibilityState === 'visible') void runRefresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('toggle', handleToggle, true);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(tick, GROCERY_REFRESH_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('toggle', handleToggle, true);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  });
</script>
<svelte:head><title>Groceries · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-3xl px-5 py-8">
  <a href={resolve('/dashboard')} class="text-teal-700">Back to home</a>
  <h1 class="mt-5 text-3xl font-bold">Grocery list</h1>
  <p class="mt-2">A shared list for your household.</p>
  <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
    {#if ready}<p role="status" class="text-slate-700">{editingPaused ? 'Updates paused while you edit.' : autoPaused ? 'Automatic updates paused.' : refreshFailed ? 'Unable to refresh right now. Showing the last list and retrying automatically.' : 'Live updates on.'}</p>{/if}
    <a href={resolve('/groceries')} data-sveltekit-reload onclick={manualRefresh} class="rounded-lg px-3 py-3 text-teal-700 underline">Refresh list</a>
    {#if ready}<button type="button" onclick={toggleAutoPaused} class="rounded-lg px-3 py-3 text-teal-700 underline">{autoPaused ? 'Resume automatic updates' : 'Pause automatic updates'}</button>{/if}
  </div>
  {#if manualNotice}<p role="status" class="mt-2 rounded-xl bg-amber-50 p-3 text-sm">{manualNotice}</p>{/if}
  {#if data.summary}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4">Added {data.summary.added} {data.summary.added === 1 ? 'item' : 'items'} and skipped {data.summary.skipped}.</p>{/if}
  {#if form?.message}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4">{form.message}</p>{/if}
  <form method="POST" action="?/add" aria-label="Add grocery item" oninput={addFormChanged} onchange={addFormChanged} class="mt-6 grid gap-3 rounded-2xl bg-white p-5 shadow-sm">
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
          <form method="POST" action="?/change" aria-label={`Edit ${item.name}`} data-grocery-edit={item.id} oninput={(event) => editFormChanged(event, item)} onchange={(event) => editFormChanged(event, item)} class="mt-3 grid gap-3">
            <input type="hidden" name="id" value={item.id} /><input type="hidden" name="version" value={form?.edit?.id === item.id ? form.edit.version : item.version} /><input type="hidden" name="completed" value={(form?.edit?.id === item.id ? form.edit.completed : item.completed) ? 'yes' : 'no'} />
            {#key editRounds[item.id] ?? 0}
              <GroceryFields initial={form?.edit?.id === item.id ? form.edit : item} />
            {/key}
            <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Save item</button>
          </form>
        </Disclosure>
        <form method="POST" action="?/remove" class="mt-3"><input type="hidden" name="id" value={item.id} /><input type="hidden" name="version" value={item.version} /><button class="rounded-xl border border-teal-700 px-4 py-3">Remove item</button></form>
      </article>
    {:else}<p class="mt-4">Your grocery list is empty.</p>{/each}
  </section>
</main>
