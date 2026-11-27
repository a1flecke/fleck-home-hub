<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { afterNavigate, beforeNavigate } from '$app/navigation';
  let { children } = $props();
  // Observable navigation state for browser tests and assistive tooling: `loading` while a
  // client-side navigation is in flight, `idle` once SvelteKit has rendered it and finished its
  // focus reset (afterNavigate runs last). Absent until hydration, and always absent without
  // JavaScript. See docs/testing-and-frontend.md.
  beforeNavigate(({ willUnload }) => {
    if (!willUnload) document.documentElement.dataset.navigation = 'loading';
  });
  afterNavigate(() => {
    document.documentElement.dataset.navigation = 'idle';
  });
  onMount(() => {
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => {
        // Registration requires HTTPS and a supported browser; the paste workflow still works.
      });
    }
  });
</script>
{@render children()}
