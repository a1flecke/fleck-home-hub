<script lang="ts">
  import { resolve } from '$app/paths';
  let { data, form } = $props();
  let message = $state('');
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  async function signOut() {
    const response = await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (response.ok) window.location.assign('/');
    else message = 'Unable to sign out. Please try again.';
  }
</script>
<svelte:head><title>My day · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-4xl px-5 py-8">
  <a href={resolve('/')} class="text-teal-700">Family display</a>
  <h1 class="mt-6 text-3xl font-bold">{data.role === 'parent' ? `Hello, ${data.name}` : `${data.name}'s My Day`}</h1>
  <p class="mt-2">{data.role === 'parent' ? 'Parent dashboard' : 'Your day'}</p>
  {#if form?.message}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4 text-teal-900">{form.message}</p>{/if}
  {#if data.balances.length}
    <section class="mt-6 rounded-2xl bg-amber-50 p-5"><h2 class="text-xl font-bold">Earnings</h2>
      {#each data.balances as balance (balance.id)}<div class="mt-3"><strong>{balance.name}</strong><p>Waiting for verification: {money(balance.pending)}</p><p>Verified earnings owed: {money(balance.earned)}</p></div>{/each}
    </section>
  {/if}
  {#if data.role === 'parent'}
    <details class="mt-6 rounded-2xl bg-white p-5 shadow-sm"><summary class="cursor-pointer text-xl font-bold">Add a chore</summary>
      {#if data.children.length}
        <form method="POST" action="?/create" class="mt-4 grid gap-3">
          <label>Chore title<input name="title" required maxlength="120" class="mt-1 w-full rounded-lg border p-3" /></label>
          <label>Description (optional)<textarea name="description" maxlength="1000" class="mt-1 w-full rounded-lg border p-3"></textarea></label>
          <label>Assigned child<select name="assignee" class="mt-1 w-full rounded-lg border p-3">{#each data.children as child (child.id)}<option value={child.id}>{child.name}</option>{/each}</select></label>
          <label>Due date<input name="dueDate" type="date" required class="mt-1 w-full rounded-lg border p-3" /></label>
          <label>Reward in dollars<input name="reward" type="number" min="0" max="1000000" step="0.01" class="mt-1 w-full rounded-lg border p-3" /></label>
          <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Add chore</button>
        </form>
      {:else}<p class="mt-3">Add a child account before assigning a chore.</p>{/if}
    </details>
  {/if}
  <section class="mt-6"><h2 class="text-xl font-bold">{data.role === 'parent' ? 'Family chores' : 'My chores'}</h2>
    {#if !data.chores.length}<p class="mt-3 rounded-2xl bg-white p-5">No chores yet. Enjoy your day!</p>{/if}
    {#each data.chores as chore, index (chore.id)}
      {#if chore.status === 'pending_verification' && index === 0}<h3 class="mt-5 font-bold">Awaiting verification</h3>{/if}
      {#if chore.status === 'verified' && (index === 0 || data.chores[index - 1].status !== 'verified')}<h3 class="mt-5 font-bold">Verified history</h3>{/if}
      <article class="mt-4 rounded-2xl bg-white p-5 shadow-sm">
        <h3 class="text-lg font-bold">{chore.title}</h3>
        {#if chore.description}<p class="mt-1">{chore.description}</p>{/if}
        <p class="mt-2 text-sm">{data.role === 'parent' ? `${chore.childName} · ` : ''}Due {chore.dueDate} {chore.rewardCents ? `· ${money(chore.rewardCents)} reward` : ''}</p>
        {#if chore.status === 'todo'}<p class="mt-3 font-semibold">To do</p>
        {:else if chore.status === 'pending_verification'}<p class="mt-3 font-semibold">Waiting for parent verification</p>
        {:else if chore.status === 'needs_rework'}<p class="mt-3 font-semibold">Needs rework</p>{#if chore.reworkReason}<p>{chore.reworkReason}</p>{/if}
        {:else}<p class="mt-3 font-semibold">{chore.rewardCents ? `Approved! You earned ${money(chore.rewardCents)}!` : 'Approved! Great work!'}</p>{/if}
        {#if data.role === 'kid' && (chore.status === 'todo' || chore.status === 'needs_rework')}
          <form method="POST" action="?/transition" class="mt-4"><input type="hidden" name="id" value={chore.id} /><button name="action" value="submit" class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Mark complete</button></form>
        {:else if data.role === 'parent' && chore.status === 'pending_verification'}
          <form method="POST" action="?/transition" class="mt-4 grid gap-3"><input type="hidden" name="id" value={chore.id} /><label>Rework reason<input name="reason" maxlength="1000" class="mt-1 w-full rounded-lg border p-3" /></label><div class="flex flex-wrap gap-3"><button name="action" value="verify" class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Verify</button><button name="action" value="rework" class="rounded-xl border border-teal-700 px-4 py-3">Needs rework</button></div></form>
        {/if}
      </article>
    {/each}
  </section>
  {#if message}<p role="status" class="mt-4">{message}</p>{/if}
  <button onclick={signOut} class="mt-8 rounded-xl border border-teal-700 px-4 py-3 text-teal-700">Sign out</button>
</main>
