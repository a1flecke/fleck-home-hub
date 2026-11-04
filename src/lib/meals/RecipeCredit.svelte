<script lang="ts">
  import { recipeAttribution } from './recipe-link';
  let { source, recipeUrl }: { source?: string | null; recipeUrl?: string | null } = $props();
  let attribution = $derived(recipeAttribution(source, recipeUrl));
</script>
{#if attribution?.credit}<p class="mt-2">{attribution.credit}</p>{/if}
{#if attribution?.verifiedSource && attribution.enteredSource}<p class="mt-1 text-sm">Family-entered source: {attribution.enteredSource}</p>{/if}
{#if attribution?.linkLabel && attribution.url}<a href={attribution.url} rel="external noopener noreferrer" class="mt-2 inline-block text-teal-700">{attribution.linkLabel}</a>{/if}
