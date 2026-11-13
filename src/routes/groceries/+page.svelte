<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount, untrack } from 'svelte';
  import Disclosure from '../calendar/Disclosure.svelte';
  import { groupGroceryItems, type GroceryGroupName } from '../../lib/grocery/grouping';
  import {
    classifyGroceryRefreshResponse,
    GROCERY_DATA_PATH,
    GROCERY_REFRESH_INTERVAL_MS,
    GROCERY_REFRESH_TIMEOUT_MS,
    groceryAddDraftExists,
    groceryDraftIsDirty,
    parseGroceryItems
  } from '../../lib/grocery/live-update';
  import GroceryFields from './GroceryFields.svelte';
  import type { PageData } from './$types';
  type Input = { name: string; quantity: string; unit: string };
  type Item = PageData['items'][number];
  type ClearFeedback = { ok: boolean; cleared?: number; changed?: boolean; message?: string };
  let { data, form }: { data: PageData; form: { message?: string; item?: Input; duplicate?: boolean; edit?: Input & { id: string; version: number; completed: boolean }; clear?: ClearFeedback } | null } = $props();

  let ready = $state(false);
  let refreshFailed = $state(false);
  let authorizationLost = $state(false);
  let addDirty = $state(false);
  let dirtyEdits = $state<string[]>([]);
  let openEdits = $state<string[]>([]);
  let removedWhileEditing = $state<string[]>([]);
  let autoPaused = $state(false);
  let manualNotice = $state('');
  let editRounds = $state<Record<string, number>>({});
  let pinnedGroups = $state<Record<string, GroceryGroupName>>({});
  let failedBoughtEdit = $derived(Boolean(form?.edit?.completed));
  let recoveryOpen = $derived(Boolean(form?.edit && openEdits.includes(form.edit.id)));
  let editingPaused = $derived(addDirty || dirtyEdits.length > 0 || recoveryOpen);
  let items = $state<Item[]>(untrack(() => data.items));
  let groups = $derived(groupGroceryItems(items, pinnedGroups));
  let inFlight = false;
  let disposed = false;
  let request: AbortController | null = null;
  let dataVersion = 0;
  let serverItems = untrack(() => data.items);

  function draft(formElement: HTMLFormElement) {
    const values = new FormData(formElement);
    return {
      name: String(values.get('name') ?? ''),
      quantity: String(values.get('quantity') ?? ''),
      unit: String(values.get('unit') ?? '')
    };
  }

  function openEditIds(): string[] {
    const ids = [...openEdits];
    if (typeof document === 'undefined') return ids;
    document.querySelectorAll<HTMLFormElement>('form[data-grocery-edit]').forEach(formElement => {
      const id = formElement.dataset.groceryEdit;
      if (id && formElement.closest('details')?.open && !ids.includes(id)) ids.push(id);
    });
    return ids;
  }

  function addUnique(values: string[], value: string): string[] {
    return values.includes(value) ? values : [...values, value];
  }

  function groupOf(item: Item): GroceryGroupName {
    return item.completed ? 'bought' : 'toBuy';
  }

  function pinGroup(id: string, group: GroceryGroupName) {
    if (pinnedGroups[id]) return;
    pinnedGroups = { ...pinnedGroups, [id]: group };
  }

  function unpinGroup(id: string) {
    if (!(id in pinnedGroups)) return;
    const next = { ...pinnedGroups };
    delete next[id];
    pinnedGroups = next;
  }

  function applyServerItems(next: Item[]) {
    const open = openEditIds();
    const removed = items.filter(item => !next.some(value => value.id === item.id) && open.includes(item.id)).map(item => item.id);
    if (removed.length) removedWhileEditing = [...removedWhileEditing, ...removed.filter(id => !removedWhileEditing.includes(id))];
    const retained = items.filter(item => !next.some(value => value.id === item.id) && (open.includes(item.id) || removedWhileEditing.includes(item.id)));
    const merged = [...next];
    for (const item of retained) {
      const oldIndex = items.findIndex(value => value.id === item.id);
      merged.splice(Math.min(oldIndex, merged.length), 0, item);
    }
    removedWhileEditing = removedWhileEditing.filter(id => !next.some(item => item.id === id) && retained.some(item => item.id === id));
    for (const id of Object.keys(pinnedGroups)) if (!merged.some(item => item.id === id)) unpinGroup(id);
    items = merged;
  }

  $effect(() => {
    if (authorizationLost) return;
    const next = data.items;
    if (next === serverItems) return;
    serverItems = next;
    dataVersion += 1;
    applyServerItems(next);
  });

  $effect(() => {
    const edit = form?.edit;
    if (!edit || authorizationLost || !openEditIds().includes(edit.id)) return;
    pinGroup(edit.id, edit.completed ? 'bought' : 'toBuy');
    if (items.some(item => item.id === edit.id)) return;
    if (!removedWhileEditing.includes(edit.id)) removedWhileEditing = [...removedWhileEditing, edit.id];
    items = [...items, { id: edit.id, name: edit.name, quantity: edit.quantity, unit: edit.unit, completed: edit.completed, version: edit.version }];
  });

  function addFormChanged(event: Event) {
    const formElement = event.currentTarget as HTMLFormElement;
    const values = new FormData(formElement);
    addDirty = groceryAddDraftExists({ ...draft(formElement), allowDuplicate: values.get('allowDuplicate') === 'yes' });
    manualNotice = '';
  }

  function editFormChanged(event: Event, item: Item) {
    const dirty = groceryDraftIsDirty(draft(event.currentTarget as HTMLFormElement), item);
    dirtyEdits = dirty ? addUnique(dirtyEdits, item.id) : dirtyEdits.filter(id => id !== item.id);
    manualNotice = '';
  }

  function handleToggle(event: Event) {
    const target = event.target;
    if (!(target instanceof HTMLDetailsElement)) return;
    if (target.dataset.groceryGroup) return;
    const formElement = target.querySelector<HTMLFormElement>('form[data-grocery-edit]');
    const id = formElement?.dataset.groceryEdit ?? '';
    if (!id) return;
    if (target.open) {
      openEdits = addUnique(openEdits, id);
      const item = items.find(value => value.id === id);
      if (item) pinGroup(id, groupOf(item));
      return;
    }
    const wasRemoved = removedWhileEditing.includes(id);
    openEdits = openEdits.filter(value => value !== id);
    dirtyEdits = dirtyEdits.filter(value => value !== id);
    removedWhileEditing = removedWhileEditing.filter(value => value !== id);
    // A failed edit still referenced by the form prop must not move to the other group,
    // because remounting its disclosure would force it open again.
    if (form?.edit?.id !== id) unpinGroup(id);
    if (wasRemoved) items = items.filter(item => item.id !== id);
    editRounds = { ...editRounds, [id]: (editRounds[id] ?? 0) + 1 };
    manualNotice = '';
  }

  function manualRefresh(event: MouseEvent) {
    if (!ready) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (authorizationLost) return;
    event.preventDefault();
    void runRefresh(true);
  }

  function toggleAutoPaused() {
    autoPaused = !autoPaused;
    manualNotice = '';
    if (!autoPaused && document.visibilityState === 'visible') void runRefresh();
  }

  async function endSession() {
    if (disposed || authorizationLost) return;
    authorizationLost = true;
    refreshFailed = false;
    await goto(resolve('/sign-in'));
  }

  function loseAccess() {
    authorizationLost = true;
    refreshFailed = false;
    manualNotice = '';
    items = [];
    removedWhileEditing = [];
    dirtyEdits = [];
    openEdits = [];
    pinnedGroups = {};
  }

  async function runRefresh(manual = false) {
    if (disposed || authorizationLost) return;
    if (editingPaused) {
      if (manual) manualNotice = 'Finish or clear your changes before refreshing.';
      return;
    }
    if (!navigator.onLine) {
      refreshFailed = true;
      if (manual) manualNotice = 'You appear to be offline. The list will update when the connection returns.';
      return;
    }
    if (inFlight) return;
    inFlight = true;
    if (manual) manualNotice = '';
    const version = dataVersion;
    const controller = new AbortController();
    request = controller;
    const timeout = window.setTimeout(() => controller.abort(), GROCERY_REFRESH_TIMEOUT_MS);
    try {
      const response = await fetch(GROCERY_DATA_PATH, {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      });
      if (disposed || version !== dataVersion) return;
      const status = classifyGroceryRefreshResponse(response.status, response.headers.get('content-type'), response.redirected, response.url);
      if (status === 'unauthenticated') { await endSession(); return; }
      if (status === 'forbidden') { loseAccess(); return; }
      if (status === 'transient') { refreshFailed = true; return; }
      const next = parseGroceryItems(await response.json());
      if (!next) { refreshFailed = true; return; }
      applyServerItems(next);
      refreshFailed = false;
      manualNotice = '';
    } catch {
      if (!disposed && version === dataVersion && !authorizationLost) refreshFailed = true;
    } finally {
      window.clearTimeout(timeout);
      if (request === controller) request = null;
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
      openEdits = addUnique(openEdits, failedForm.edit.id);
      pinGroup(failedForm.edit.id, failedForm.edit.completed ? 'bought' : 'toBuy');
    }
    for (const id of openEditIds()) {
      openEdits = addUnique(openEdits, id);
      const item = items.find(value => value.id === id);
      if (item) pinGroup(id, groupOf(item));
    }

    const tick = () => {
      if (document.visibilityState !== 'visible' || autoPaused) return;
      void runRefresh();
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') tick(); };
    const onOffline = () => { if (!disposed && !authorizationLost) refreshFailed = true; };
    const onOnline = () => { if (!disposed && !authorizationLost && !autoPaused && document.visibilityState === 'visible') void runRefresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('toggle', handleToggle, true);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(tick, GROCERY_REFRESH_INTERVAL_MS);
    return () => {
      disposed = true;
      request?.abort();
      request = null;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('toggle', handleToggle, true);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  });
</script>
{#snippet groceryItem(item: Item)}
  <article class="rounded-2xl bg-white p-5 shadow-sm">
    <h3 class="text-xl font-bold">{item.name}</h3>
    {#if item.quantity || item.unit}<p class="mt-1 text-lg">{item.quantity} {item.unit}</p>{/if}
    <p class="mt-1 text-sm text-slate-700">{item.completed ? 'Bought' : 'To buy'}</p>
    {#if removedWhileEditing.includes(item.id)}<p role="status" class="mt-2 rounded-xl bg-amber-50 p-3 text-sm">This item was removed in another session. Your unsaved changes are kept here, but saving will be rejected.</p>{/if}
    <form method="POST" action="?/change" class="mt-3">
      <input type="hidden" name="id" value={item.id} /><input type="hidden" name="version" value={item.version} />
      <input type="hidden" name="name" value={item.name} /><input type="hidden" name="quantity" value={item.quantity} /><input type="hidden" name="unit" value={item.unit} />
      <input type="hidden" name="completed" value={item.completed ? 'no' : 'yes'} />
      <button class={item.completed ? 'w-full rounded-xl border border-teal-700 px-4 py-3 text-lg font-bold' : 'w-full rounded-xl bg-teal-700 px-4 py-3 text-lg font-bold text-white'}>{item.completed ? 'Mark to buy' : 'Mark bought'}</button>
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
    <form method="POST" action="?/remove" class="mt-3"><input type="hidden" name="id" value={item.id} /><input type="hidden" name="version" value={item.version} /><button class="w-full rounded-xl border border-teal-700 px-4 py-3">Remove item</button></form>
  </article>
{/snippet}
{#snippet boughtPanel()}
  <summary class="cursor-pointer p-5 text-xl font-bold"><span id="bought-heading">Bought</span> <span class="ml-1 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-800">{groups.bought.length}</span></summary>
  <div class="px-5 pb-5">
    {#if groups.bought.length}
      <p class="text-sm text-slate-700">Bought items stay here until a parent clears them.</p>
      <div class="mt-4 grid gap-4">{#each groups.bought as item (item.id)}{@render groceryItem(item)}{/each}</div>
      {#if data.role === 'parent'}
        <details class="mt-5 rounded-xl border border-slate-200 p-4">
          <summary class="cursor-pointer font-bold">Clear bought items…</summary>
          <form method="POST" action="?/clearBought" aria-label="Clear bought items" class="mt-3 grid gap-3">
            <p class="text-sm text-slate-700">This permanently removes these {groups.bought.length} bought {groups.bought.length === 1 ? 'record' : 'records'} from the active list. It is not a hide or archive, and there is no undo.</p>
            {#each groups.bought as item (item.id)}
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="version" value={item.version} />
            {/each}
            <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Clear {groups.bought.length} bought {groups.bought.length === 1 ? 'item' : 'items'}</button>
          </form>
        </details>
      {/if}
    {:else}
      <p class="text-slate-700">No bought items right now.</p>
    {/if}
  </div>
{/snippet}
<svelte:head><title>Groceries · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-3xl px-5 py-8">
  <a href={resolve('/dashboard')} class="text-teal-700">Back to home</a>
  <h1 class="mt-5 text-3xl font-bold">Grocery list</h1>
  <p class="mt-2">A shared list for your household.</p>
  <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
    {#if ready}<p role="status" class="text-slate-700">{authorizationLost ? 'You no longer have access to this grocery list.' : editingPaused ? 'Updates paused while you edit.' : autoPaused ? 'Automatic updates paused.' : refreshFailed ? 'Unable to refresh right now. Showing the last list and retrying automatically.' : 'Live updates on.'}</p>{/if}
    <a href={resolve('/groceries')} data-sveltekit-reload onclick={manualRefresh} class="rounded-lg px-3 py-3 text-teal-700 underline">Refresh list</a>
    {#if ready}<button type="button" onclick={toggleAutoPaused} class="rounded-lg px-3 py-3 text-teal-700 underline">{autoPaused ? 'Resume automatic updates' : 'Pause automatic updates'}</button>{/if}
  </div>
  {#if manualNotice}<p role="status" class="mt-2 rounded-xl bg-amber-50 p-3 text-sm">{manualNotice}</p>{/if}
  {#if data.summary}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4">Added {data.summary.added} {data.summary.added === 1 ? 'item' : 'items'} and skipped {data.summary.skipped}.</p>{/if}
  {#if form?.message}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4">{form.message}</p>{/if}
  {#if form?.clear?.ok}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4">Cleared {form.clear.cleared} bought {form.clear.cleared === 1 ? 'item' : 'items'}. The rest of the list is unchanged.</p>{/if}
  {#if form?.clear && !form.clear.ok}<p role="alert" class="mt-4 rounded-xl bg-amber-50 p-4">{form.clear.message}</p>{/if}
  <form method="POST" action="?/add" aria-label="Add grocery item" oninput={addFormChanged} onchange={addFormChanged} class="mt-6 grid gap-3 rounded-2xl bg-white p-5 shadow-sm">
    <GroceryFields initial={form?.item ?? { name: '', quantity: '', unit: '' }} />
    {#if form?.duplicate}<label><input type="checkbox" name="allowDuplicate" value="yes" required /> Add another anyway</label>{/if}
    <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Add item</button>
  </form>
  <section aria-labelledby="to-buy-heading" class="mt-6">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="to-buy-heading" class="text-2xl font-bold">To buy</h2>
      <p class="rounded-full bg-teal-50 px-3 py-1 text-sm font-bold text-teal-900">{groups.toBuy.length} {groups.toBuy.length === 1 ? 'item' : 'items'} to buy</p>
    </div>
    {#if groups.toBuy.length}
      <div class="mt-4 grid gap-4">{#each groups.toBuy as item (item.id)}{@render groceryItem(item)}{/each}</div>
    {:else}
      <p class="mt-4 rounded-2xl bg-white p-5 text-slate-700">Nothing left to buy.</p>
    {/if}
  </section>
  <section aria-labelledby="bought-heading" class="mt-6">
    {#if failedBoughtEdit}
      <details open data-grocery-group="bought" class="rounded-2xl bg-white shadow-sm">{@render boughtPanel()}</details>
    {:else}
      <details data-grocery-group="bought" class="rounded-2xl bg-white shadow-sm">{@render boughtPanel()}</details>
    {/if}
  </section>
</main>
