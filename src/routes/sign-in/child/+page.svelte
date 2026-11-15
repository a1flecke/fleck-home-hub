<script lang="ts">
  import { resolve } from '$app/paths';
  let { form } = $props();
</script>

<svelte:head><title>Child sign-in · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-md px-5 py-10">
  <a href={resolve('/sign-in')} class="font-semibold text-teal-800">Back to sign-in</a>
  <div class="mt-5 rounded-3xl bg-white p-6 shadow-sm sm:p-8">
    <h1 class="text-3xl font-bold">Child sign-in</h1>
    <p class="mt-2">Use the username and password your parent gave you to see your day.</p>
    {#if form?.message}<p role="alert" class="mt-4 rounded-xl bg-red-50 p-3 text-red-800">{form.message}</p>{/if}
    <form method="POST" aria-label="Child sign-in" class="mt-6 grid gap-4">
      <label class="grid gap-1 font-medium">Username<input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="32" defaultValue={form?.username ?? ''} class="rounded-xl border border-gray-400 p-3" /></label>
      <label class="grid gap-1 font-medium">Password<input name="password" type="password" autocomplete="current-password" required maxlength="128" class="rounded-xl border border-gray-400 p-3" /></label>
      <button class="justify-self-start rounded-xl bg-teal-800 px-5 py-3 font-semibold text-white">Sign in</button>
    </form>
  </div>
</main>
