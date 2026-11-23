<script lang="ts">
  let { id, name, initial }: { id: string; name: string; initial: boolean } = $props();
  let checked = $derived(initial);
</script>
<label class="flex items-center gap-3"><input name="assignee" type="checkbox" value={id} bind:checked={checked} />{name}</label>
