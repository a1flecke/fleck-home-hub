<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  let { children } = $props();
  onMount(() => {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => {
        // Registration requires HTTPS and a supported browser; the paste workflow still works.
      });
    }
  });
</script>
{@render children()}
