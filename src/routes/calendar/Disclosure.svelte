<script lang="ts">
  import type { Snippet } from 'svelte';
  let { expanded = false, class: className = '', children }: { expanded?: boolean; class?: string; children: Snippet } = $props();
</script>

{#if expanded}
  <details class={className} open>{@render children()}</details>
{:else}
  <details class={className}>{@render children()}</details>
{/if}
