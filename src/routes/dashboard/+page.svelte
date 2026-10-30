<script lang="ts">
  import { resolve } from '$app/paths';
  let { data, form } = $props();
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
</script>
<svelte:head><title>My day · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-4xl px-5 py-8">
  <a href={resolve('/')} class="text-teal-700">Family display</a>
  <h1 class="mt-6 text-3xl font-bold">{data.role === 'parent' ? `Hello, ${data.name}` : `${data.name}'s My Day`}</h1>
  <p class="mt-2">{data.role === 'parent' ? 'Parent dashboard' : 'Your day'}</p>
  {#if form?.message}<p role="status" class="mt-4 rounded-xl bg-teal-50 p-4 text-teal-900">{form.message}</p>{/if}
  {#if data.balances.length}
    <section class="mt-6 rounded-2xl bg-amber-50 p-5"><h2 class="text-xl font-bold">Earnings</h2>
      {#if data.payday}<p class="mt-2">Next payday: {data.payday.next}</p>{/if}
      {#each data.balances as balance (balance.id)}<article aria-label={`Earnings for ${balance.name}`} class="mt-4"><h3 class="font-bold">{balance.name}</h3><p>Waiting for verification: {money(balance.pending)}</p><p>Verified earnings owed: {money(balance.owed)}</p><p>Paid so far: {money(balance.paid)}</p><p>Total verified earnings: {money(balance.earned)}</p>
        {#if data.role === 'parent' && balance.owed > 0}
          <details class="mt-3"><summary class="cursor-pointer font-semibold">Record a payment</summary><p class="mt-2 text-sm">Record money you have already paid; this does not transfer money.</p>
            <form method="POST" action="?/payout" class="mt-3 grid gap-3"><input type="hidden" name="child" value={balance.id} /><input type="hidden" name="requestId" value={balance.requestId} />
              <label>Payment amount<input name="amount" type="number" min="0.01" max={(balance.owed / 100).toFixed(2)} step="0.01" required value={(balance.owed / 100).toFixed(2)} class="mt-1 block w-full rounded-lg border p-3" /></label>
              <label>Payment date<input name="date" type="date" value={data.today} required class="mt-1 block w-full rounded-lg border p-3" /></label>
              <label>Payment note<input name="note" maxlength="1000" class="mt-1 block w-full rounded-lg border p-3" /></label>
              <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Record payment</button>
            </form>
          </details>
        {/if}
        {#if balance.payouts.length}<div class="mt-3"><h4 class="font-semibold">Payment history</h4>{#each balance.payouts as payment (payment.id)}<div class="mt-2"><p>{payment.paidDate} · {money(payment.amountCents)}{payment.reversalReason ? ' · Corrected' : ''}</p>{#if payment.note}<p>{payment.note}</p>{/if}{#if payment.reversalReason}<p>Correction: {payment.reversalReason}</p>{:else if data.role === 'parent'}<details><summary class="cursor-pointer">Correct this payment</summary><p class="mt-2 text-sm">This reverses the whole record and restores the amount owed; it does not transfer money.</p><form method="POST" action="?/reversePayout" class="mt-2 grid gap-2"><input type="hidden" name="id" value={payment.id} /><label>Correction reason<input name="reason" required maxlength="1000" class="mt-1 block w-full rounded-lg border p-3" /></label><button class="rounded-xl border border-teal-700 px-4 py-3">Record correction</button></form></details>{/if}</div>{/each}</div>{/if}
      </article>{/each}
    </section>
  {/if}
  {#if data.role === 'parent'}
    <details class="mt-6 rounded-2xl bg-white p-5 shadow-sm"><summary class="cursor-pointer font-bold">Payday schedule</summary><p class="mt-2 text-sm">A reminder only; no money is transferred automatically.</p><form method="POST" action="?/payday" class="mt-3 grid gap-3"><label>First payday<input name="anchor" type="date" value={data.payday?.anchor ?? data.today} required class="mt-1 block w-full rounded-lg border p-3" /></label><label>Frequency<select name="cadence" class="mt-1 block w-full rounded-lg border p-3"><option value="7" selected={data.payday?.cadence !== 14}>Weekly</option><option value="14" selected={data.payday?.cadence === 14}>Every two weeks</option></select></label><button class="rounded-xl border border-teal-700 px-4 py-3">Save payday</button></form></details>
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
    <details class="mt-6 rounded-2xl bg-white p-5 shadow-sm"><summary class="cursor-pointer font-bold">Household time zone</summary><form method="POST" action="?/timezone" class="mt-3 flex flex-wrap items-end gap-3"><label>Time zone (for example, America/Chicago)<input name="timezone" value={data.timezone} required class="mt-1 block rounded-lg border p-3" /></label><button class="rounded-xl border border-teal-700 px-4 py-3">Save time zone</button></form></details>
    <details class="mt-6 rounded-2xl bg-white p-5 shadow-sm"><summary class="cursor-pointer text-xl font-bold">Add a recurring chore</summary>
      {#if data.children.length}
        <form method="POST" action="?/series" class="mt-4 grid gap-3">
          <label>Recurring chore title<input name="title" required maxlength="120" class="mt-1 w-full rounded-lg border p-3" /></label>
          <label>Description (optional)<textarea name="description" maxlength="1000" class="mt-1 w-full rounded-lg border p-3"></textarea></label>
          <label>Recurring assigned child<select name="assignee" class="mt-1 w-full rounded-lg border p-3">{#each data.children as child (child.id)}<option value={child.id}>{child.name}</option>{/each}</select></label>
          <label>Starts on<input name="startDate" type="date" required value={data.today} class="mt-1 w-full rounded-lg border p-3" /></label>
          <label>Ends on (optional)<input name="endDate" type="date" class="mt-1 w-full rounded-lg border p-3" /></label>
          <fieldset><legend class="font-semibold">Repeat on</legend><div class="mt-2 flex flex-wrap gap-3">{#each days as day, index (day)}<label class="flex items-center gap-2"><input name="weekday" type="checkbox" value={index} />{day}</label>{/each}</div></fieldset>
          <label>Recurring reward in dollars<input name="reward" type="number" min="0" max="1000000" step="0.01" class="mt-1 w-full rounded-lg border p-3" /></label>
          <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Add recurring chore</button>
        </form>
      {:else}<p class="mt-3">Add a child account before assigning a chore.</p>{/if}
    </details>
    {#if data.series.length}
      <section class="mt-6"><h2 class="text-xl font-bold">Recurring chores</h2><p class="mt-1">Scheduled in {data.timezone}. Changes apply to future unstarted occurrences.</p>
        {#each data.series as series (series.id)}
          <article class="mt-4 rounded-2xl bg-white p-5 shadow-sm"><h3 class="text-lg font-bold">{series.title}</h3><p class="mt-2">{series.state} · {JSON.parse(series.weekdays).map((day: number) => days[day]).join(', ')}</p>
            {#if series.state === 'active'}<p>{series.next ? `Next: ${series.next}` : 'No upcoming occurrence in the next seven days.'}</p>{/if}
            {#if series.skips.length}<p>Skipped: {series.skips.join(', ')}</p>{/if}
            {#if series.state !== 'ended'}
              <details class="mt-3"><summary class="cursor-pointer font-semibold">Edit future chores</summary>
                <form method="POST" action="?/series" class="mt-3 grid gap-3">
                  <input type="hidden" name="id" value={series.id} /><input type="hidden" name="startDate" value={series.startDate} /><input type="hidden" name="endDate" value={series.endDate ?? ''} />
                  {#each JSON.parse(series.weekdays) as day (day)}<input type="hidden" name="weekday" value={day} />{/each}
                  <label>Recurring chore title<input name="title" value={series.title} required maxlength="120" class="mt-1 w-full rounded-lg border p-3" /></label>
                  <label>Description (optional)<textarea name="description" maxlength="1000" class="mt-1 w-full rounded-lg border p-3">{series.description ?? ''}</textarea></label>
                  <label>Recurring assigned child<select name="assignee" class="mt-1 w-full rounded-lg border p-3">{#each data.children as child (child.id)}<option value={child.id} selected={child.id === series.assigneeId}>{child.name}</option>{/each}</select></label>
                  <label>Recurring reward in dollars<input name="reward" type="number" min="0" max="1000000" step="0.01" value={series.rewardCents === null ? '' : (series.rewardCents / 100).toFixed(2)} class="mt-1 w-full rounded-lg border p-3" /></label>
                  <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Save changes</button>
                </form>
              </details>
              <form method="POST" action="?/seriesControl" class="mt-3 flex flex-wrap gap-3"><input type="hidden" name="id" value={series.id} /><button name="action" value={series.state === 'active' ? 'paused' : 'active'} class="rounded-xl border border-teal-700 px-4 py-3">{series.state === 'active' ? 'Pause' : 'Resume'}</button><button name="action" value="ended" class="rounded-xl border border-teal-700 px-4 py-3">End series</button></form>
              <form method="POST" action="?/seriesControl" class="mt-3 flex flex-wrap items-end gap-3"><input type="hidden" name="id" value={series.id} /><input type="hidden" name="action" value="skip" /><label>Skip a date<input name="date" type="date" required class="mt-1 block rounded-lg border p-3" /></label><button class="rounded-xl border border-teal-700 px-4 py-3">Skip occurrence</button></form>
            {/if}
          </article>
        {/each}
      </section>
    {/if}
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
        {#if data.role === 'kid' && chore.scheduledDate && chore.scheduledDate > data.today && chore.status === 'todo'}<p class="mt-3">Coming up</p>
        {:else if data.role === 'kid' && (chore.status === 'todo' || chore.status === 'needs_rework')}
          <form method="POST" action="?/transition" class="mt-4"><input type="hidden" name="id" value={chore.id} /><button name="action" value="submit" class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Mark complete</button></form>
        {:else if data.role === 'parent' && chore.status === 'pending_verification'}
          <form method="POST" action="?/transition" class="mt-4 grid gap-3"><input type="hidden" name="id" value={chore.id} /><label>Rework reason<input name="reason" maxlength="1000" class="mt-1 w-full rounded-lg border p-3" /></label><div class="flex flex-wrap gap-3"><button name="action" value="verify" class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">Verify</button><button name="action" value="rework" class="rounded-xl border border-teal-700 px-4 py-3">Needs rework</button></div></form>
        {/if}
      </article>
    {/each}
  </section>
  <form method="POST" action={resolve('/sign-out')}><button class="mt-8 rounded-xl border border-teal-700 px-4 py-3 text-teal-700">Sign out</button></form>
</main>
