<script lang="ts">
  let { initial }: { initial: string } = $props();
  let value = $derived(initial);
</script>
<textarea name="description" aria-label="Description (optional)" maxlength="1000" bind:value={value} class="mt-1 w-full rounded-lg border p-3"></textarea>
