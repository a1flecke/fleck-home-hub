<script lang="ts">
  import Disclosure from '../../calendar/Disclosure.svelte';

  let { item, editable, archived, draft }: {
    item: { id: string; name: string; completed: boolean; completedByName: string | null; completedAt: string | null; version: number };
    editable: boolean;
    archived: boolean;
    draft?: { name: string; version: number };
  } = $props();
</script>

<article aria-label={item.name} class="border-b border-slate-200 py-3 last:border-0">
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      <h3 class="break-words font-semibold">{item.name}</h3>
      {#if item.completedAt}
        <p class="mt-1 text-xs text-slate-600">
          {item.completedByName ?? 'Family member'} · <time datetime={item.completedAt}>{item.completedAt.slice(0, 16).replace('T', ' ')} UTC</time>
        </p>
      {/if}
    </div>
    {#if !archived}
      <form method="POST" action="?/completion" class="shrink-0">
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
      <form method="POST" action="?/editItem" aria-label={'Edit ' + item.name} class="grid gap-2">
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="version" value={draft?.version ?? item.version} />
        <label>
          Item name
          <input name="name" required maxlength="120" defaultValue={draft?.name ?? item.name} data-recovery-focus={draft ? '' : undefined} class="mt-1 block w-full rounded-lg border p-3" />
        </label>
        <button class="rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white">Save item</button>
      </form>
      {#if !item.completed}
        <form method="POST" action="?/remove" class="mt-2">
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="version" value={item.version} />
          <button class="rounded-xl border border-slate-400 px-4 py-3">Remove item</button>
        </form>
      {/if}
    </Disclosure>
  {/if}
</article>
