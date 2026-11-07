<script lang="ts">
  import { resolve } from '$app/paths';
  import type { PageData } from './$types';
  let { data, form }: { data: PageData; form: { message?: string; invitationLink?: string; role?: 'parent' | 'kid' } | null } = $props();
</script>
<svelte:head><title>Household access · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-3xl px-5 py-8">
  <a href={resolve('/dashboard')} class="text-teal-700">Back to home</a>
  <h1 class="mt-5 text-3xl font-bold">Household access</h1>
  <p class="mt-2">See who can use your household and invite someone you trust.</p>
  {#if data.households.length > 1}
    <form method="GET" class="mt-5"><label>Household <select name="household" class="rounded-xl border p-3">{#each data.households as household (household.id)}<option value={household.id} selected={household.id === data.householdId}>{household.name}</option>{/each}</select></label><button class="ml-2 rounded-xl border px-4 py-3">Show household</button></form>
  {/if}
  {#if form?.message}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4">{form.message}</p>{/if}
  <section class="mt-6 rounded-2xl bg-white p-5 shadow-sm"><h2 class="text-xl font-bold">People with access</h2>
    <ul>{#each data.members.filter((member) => member.disabledAt === null) as member (member.id)}<li class="mt-4"><p>{member.name} · {member.role === 'parent' ? 'Parent' : 'Child'}{member.id === data.currentUserId ? ' (you)' : ''}</p>
      {#if member.id !== data.currentUserId}<details class="mt-2"><summary class="cursor-pointer rounded-xl border border-red-800 px-4 py-3">Disable access for {member.name}</summary><p class="mt-2">{member.name} will immediately lose access to this household, even if they are signed in. Chores, earnings and history stay. Their account and any other household they belong to are not changed. This cannot be undone here.</p><form method="POST" action="?/disable&household={encodeURIComponent(data.householdId)}" class="mt-2"><input type="hidden" name="member" value={member.id} /><button class="rounded-xl bg-red-800 px-4 py-3 font-bold text-white">Confirm disable {member.name}</button></form></details>{/if}</li>{/each}</ul>
    {#if data.members.some((member) => member.disabledAt !== null)}<h3 class="mt-6 text-lg font-bold">Disabled access</h3>
    <ul>{#each data.members.filter((member) => member.disabledAt !== null) as member (member.id)}<li class="mt-3">{member.name} · {member.role === 'parent' ? 'Parent' : 'Child'} · disabled {new Date(member.disabledAt ?? 0).toLocaleDateString()}{member.disabledByName ? ` by ${member.disabledByName}` : ''}</li>{/each}</ul>{/if}
  </section>
  <section class="mt-6 rounded-2xl bg-white p-5 shadow-sm"><h2 class="text-xl font-bold">Invite someone</h2>
    <p class="mt-2">Share the private link with someone you trust. It works once and expires after seven days. They choose their own password.</p>
    <form method="POST" action="?/invite{data.householdId ? `&household=${encodeURIComponent(data.householdId)}` : ''}" class="mt-4 grid gap-3">
      <label class="grid gap-2">Invite as <select name="role" class="rounded-xl border p-3"><option value="parent" selected={form?.role !== 'kid'}>Parent</option><option value="kid" selected={form?.role === 'kid'}>Child</option></select></label>
      <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Create invitation</button>
    </form>
    {#if form?.invitationLink}<p class="mt-4">Copy this link now; it will not be shown again. Anyone with it can use the invitation.</p><label class="mt-2 grid gap-2">Invitation link <input type="password" readonly value={form.invitationLink} class="w-full rounded-xl border p-3" onclick={(event) => event.currentTarget.select()} /></label>{/if}
  </section>
  <section class="mt-6 rounded-2xl bg-white p-5 shadow-sm"><h2 class="text-xl font-bold">Pending invitations</h2>
    {#each data.invitations as invitation (invitation.id)}<article class="mt-4"><p>{invitation.role === 'parent' ? 'Parent' : 'Child'} invitation pending</p><p>Expires {new Date(invitation.expiresAt).toLocaleDateString()}</p><details class="mt-2"><summary class="cursor-pointer rounded-xl border border-teal-700 px-4 py-3">Revoke invitation</summary><p class="mt-2">This link will stop working.</p><form method="POST" action="?/revoke&household={encodeURIComponent(data.householdId)}" class="mt-2"><input type="hidden" name="id" value={invitation.id} /><button class="rounded-xl border border-teal-700 px-4 py-3">Confirm revoke</button></form></details></article>{:else}<p class="mt-3">No pending invitations.</p>{/each}
  </section>
</main>
