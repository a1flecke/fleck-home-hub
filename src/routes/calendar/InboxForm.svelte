<script lang="ts">
  type Item = { id?: string; title?: string; description?: string | null; ownerId?: string | null };
  let { item, members, button, action }: { item: Item; members: { id: string; name: string }[]; button: string; action: string } = $props();
  let title = $derived(item.title ?? '');
  let description = $derived(item.description ?? '');
</script>
<form method="POST" {action} class="mt-4 grid gap-3">
  {#if item.id}<input type="hidden" name="id" value={item.id} />{/if}
  <label>Inbox title<input name="title" required maxlength="120" defaultValue={title} class="mt-1 block w-full rounded-lg border p-3" /></label>
  <label>Details<textarea name="description" maxlength="1000" bind:value={description} class="mt-1 block w-full rounded-lg border p-3"></textarea></label>
  <label>Tentative owner<select name="owner" class="mt-1 block w-full rounded-lg border p-3"><option value="" selected={!item.ownerId}>Anyone</option>{#each members as member (member.id)}<option value={member.id} selected={member.id === item.ownerId}>{member.name}</option>{/each}</select></label>
  <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">{button}</button>
</form>
