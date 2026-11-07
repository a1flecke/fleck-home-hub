<script lang="ts">
  import { resolve } from '$app/paths';
  let { data, form } = $props();
  const statusText = { active: 'Active', expired: 'Expired', revoked: 'Revoked' } as const;
</script>
<svelte:head><title>Household displays · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-3xl px-5 py-8">
  <a href={resolve('/display/settings')} class="text-teal-700">Choose what to share</a>
  <h1 class="mt-5 text-3xl font-bold">Household displays</h1>
  <p class="mt-2">A paired display shows only what you choose to share and cannot sign in, edit or open any other page. Revoke a display at any time; it stops receiving information on its next request.</p>
  {#if form?.message}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4">{form.message}</p>{/if}
  {#if form && 'code' in form && form.code}
    <section aria-label="New pairing code" class="mt-6 rounded-2xl border-2 border-teal-700 bg-white p-5">
      <h2 class="text-xl font-bold">Pairing code for {form.codeLabel}</h2>
      <p class="mt-3 select-all break-all font-mono text-2xl tracking-wider">{form.code}</p>
      <p class="mt-3">Enter it on the display at <strong>/display/pair</strong>. It works once and expires in 10 minutes. This is the only time it is shown; do not paste it into chat, tickets or screenshots. Make sure the display is signed out of any personal account first.</p>
    </section>
  {/if}
  <section aria-label="Pair a new display" class="mt-8">
    <h2 class="text-xl font-bold">Pair a new display</h2>
    <form method="POST" action="?/create" class="mt-3 grid gap-3">
      <label class="grid gap-2 font-semibold">Display name
        <!-- No reactive value attribute unless restoring after a rejected submission: it would overwrite text typed before hydration. -->
        {#if form && 'label' in form && form.label}
          <input name="label" required maxlength="60" value={form.label} placeholder="Kitchen screen" class="rounded-xl border border-slate-400 px-4 py-3" />
        {:else}
          <input name="label" required maxlength="60" placeholder="Kitchen screen" class="rounded-xl border border-slate-400 px-4 py-3" />
        {/if}
      </label>
      <button class="rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white">Create pairing code</button>
    </form>
  </section>
  {#if data.pending.length}
    <section aria-label="Unused pairing codes" class="mt-8"><h2 class="text-xl font-bold">Unused pairing codes</h2>
      <ul class="mt-3 grid gap-3">{#each data.pending as item (item.id)}
        <li class="rounded-xl bg-white p-4"><span class="font-semibold">{item.label}</span> · expires {item.expiresAt}
          <form method="POST" action="?/cancel" class="mt-2"><input type="hidden" name="id" value={item.id} /><button class="rounded-xl border border-teal-700 px-4 py-3" aria-label={`Cancel pairing code for ${item.label}`}>Cancel code</button></form></li>
      {/each}</ul></section>
  {/if}
  <section aria-label="Paired displays" class="mt-8"><h2 class="text-xl font-bold">Paired displays</h2>
    <ul class="mt-3 grid gap-3">
      {#each data.devices as device (device.id)}
        <li class="rounded-xl bg-white p-4" data-status={device.status}>
          <h3 class="font-semibold">{device.label}</h3>
          <p>Status: <strong>{statusText[device.status]}</strong></p>
          <p>Paired {device.pairedAt}</p>
          <p>{device.lastSeenAt ? `Last seen ${device.lastSeenAt}` : 'Not seen yet'}</p>
          {#if device.status === 'revoked'}<p>Revoked {device.revokedAt}</p>{:else}<p>{device.status === 'expired' ? 'Expired' : 'Expires'} {device.expiresAt}</p>{/if}
          {#if device.status !== 'revoked'}
            <details class="mt-2"><summary class="cursor-pointer rounded-xl border border-teal-700 px-4 py-3">Revoke {device.label}</summary>
              <form method="POST" action="?/revoke" class="mt-2"><input type="hidden" name="id" value={device.id} /><p>This display will show a pairing-required screen and must be paired again.</p><button class="mt-2 rounded-xl bg-red-700 px-4 py-3 text-white" aria-label={`Confirm revoke ${device.label}`}>Confirm revoke</button></form>
            </details>
          {/if}
        </li>
      {:else}<li>No displays are paired.</li>{/each}
    </ul>
  </section>
</main>
