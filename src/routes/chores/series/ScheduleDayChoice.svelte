<script lang="ts">
  let { index, label, initial }: { index: number; label: string; initial: boolean } = $props();
  let checked = $derived(initial);
</script>
<label class="flex items-center gap-2"><input name="weekday" type="checkbox" value={index} bind:checked={checked} />{label}</label>
