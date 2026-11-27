<script lang="ts">
  import Disclosure from '../../calendar/Disclosure.svelte';

  let { item, editable, archived, assignees, action, draft }: {
    item: { id: string; name: string; completed: boolean; completedByName: string | null; completedAt: string | null; version: number; assignedTo: string | null; assigneeName: string | null; assigneeActive: boolean; canComplete: boolean };
    editable: boolean;
    archived: boolean;
    assignees: { id: string; name: string }[];
    action: (name: string) => string;
    draft?: { name: string; version: number; assignedTo?: string | null };
  } = $props();
  let selected = $derived(draft?.assignedTo === undefined ? item.assignedTo : draft.assignedTo);
  let unavailable = $derived(selected !== null && !assignees.some(person => person.id === selected));
</script>

<article aria-label={item.name} class="border-b border-slate-200 py-3 last:border-0">
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <h3 class="break-words font-semibold">{item.name}</h3>
      <p class="mt-1 break-words text-sm text-slate-600">
        {item.assigneeName ? `Assigned to ${item.assigneeName}${item.assigneeActive ? '' : ' (inactive)'}` : 'Unassigned'}
      </p>
      {#if item.completed && item.completedAt}
        <p class="mt-1 text-xs text-slate-600">
          {item.completedByName ?? 'Family member'} · <time datetime={item.completedAt}>{item.completedAt.slice(0, 16).replace('T', ' ')} UTC</time>
        </p>
      {/if}
    </div>
    {#if !archived && item.canComplete}
      <form method="POST" action={action('completion')} class="shrink-0">
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="version" value={item.version} />
        <button name="completed" value={item.completed ? 'no' : 'yes'} class="min-h-11 rounded-xl border border-teal-700 px-3 text-sm font-semibold text-teal-800">
          {item.completed ? 'Mark not ready' : 'Mark ready'}
        </button>
      </form>
    {/if}
  </div>
  {#if editable && !archived}
    <Disclosure expanded={!!draft}>
      <summary class="min-h-11 w-fit cursor-pointer py-3 text-sm font-semibold text-slate-700">Edit item</summary>
      <form method="POST" action={action('editItem')} aria-label={'Edit ' + item.name} class="grid gap-2">
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="version" value={draft?.version ?? item.version} />
        <label>
          Item name
          <input name="name" required maxlength="120" defaultValue={draft?.name ?? item.name} data-recovery-focus={draft ? '' : undefined} class="mt-1 block w-full rounded-lg border p-3" />
        </label>
        <label>
          Assigned to
          <select name="assignedTo" class="mt-1 block min-h-11 w-full rounded-lg border bg-white p-3">
            <option value="" selected={selected === null}>Unassigned</option>
            {#if unavailable}
              <option value={selected} selected>{selected === item.assignedTo ? `${item.assigneeName} (inactive)` : 'Unavailable member'}</option>
            {/if}
            {#each assignees as person (person.id)}
              <option value={person.id} selected={person.id === selected}>{person.name}</option>
            {/each}
          </select>
        </label>
        <button class="rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white">Save item</button>
      </form>
      {#if !item.completed}
        <form method="POST" action={action('remove')} class="mt-2">
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="version" value={item.version} />
          <button class="rounded-xl border border-slate-400 px-4 py-3">Remove item</button>
        </form>
      {/if}
    </Disclosure>
  {/if}
</article>
