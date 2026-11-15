<script lang="ts">
  import { resolve } from '$app/paths';
  import ChildProfiles from '../../lib/onboarding/ChildProfiles.svelte';
  let { data, form } = $props();
  let pending = $derived(data.invitations.find(invite => invite.status === 'Pending'));
  const steps = { parents: 1, children: 2, activities: 3 };
</script>

<svelte:head><title>Set up your family · Fleck Home Hub</title></svelte:head>
<main class="mx-auto max-w-2xl px-5 py-8 sm:py-12">
  <a href={resolve('/dashboard')} class="font-semibold text-teal-800">Fleck Home Hub</a>
  <div class="mt-5 rounded-3xl bg-white p-6 shadow-sm sm:p-9">
    <p class="text-sm font-semibold text-teal-800">{data.household.name} · Step {steps[data.step]} of 3</p>
    {#if form && 'message' in form && form.message}<p role="alert" class="mt-4 rounded-xl bg-red-50 p-3 text-red-800">{form.message}</p>{/if}

    {#if data.step === 'parents'}
      <h1 class="mt-2 text-3xl font-bold">Invite another parent</h1>
      <p class="mt-2">Give your partner or another caregiver their own account. Share an invite privately so they can choose their own password.</p>
      {#if form && 'invitationLink' in form && form.invitationLink}
        <section aria-label="Parent invitation ready" class="mt-5 rounded-xl bg-teal-50 p-4">
          <p role="status" class="font-semibold">Your invitation is ready to share.</p>
          <label class="mt-3 grid gap-1 text-sm">Share this link<input readonly value={form.invitationLink} class="w-full rounded-lg border border-gray-400 bg-white p-2" /></label>
          <p class="mt-2 text-sm">Select and copy the link. It expires in seven days.</p>
        </section>
      {/if}
      {#if data.invitations.length}
        <section aria-label="Parent invitations" class="mt-5 rounded-xl border border-teal-100 p-4">
          <h2 class="font-bold">Invitation status</h2>
          <ul class="mt-2 space-y-1">
            {#each data.invitations as invite (invite.id)}<li>Parent invitation · {invite.status}</li>{/each}
          </ul>
        </section>
      {/if}
      {#if pending}
        <details class="mt-5">
          <summary class="cursor-pointer font-semibold text-teal-800">Replace the pending link</summary>
          <p class="mt-2">The old link will stop working. Share the new one with the parent you want to invite.</p>
          <form method="POST" action="?/invite" class="mt-3">
            <input type="hidden" name="replace" value={pending.id} />
            <button class="rounded-xl border border-teal-800 px-4 py-2 font-semibold text-teal-900">Replace invitation</button>
          </form>
        </details>
      {:else}
        <form method="POST" action="?/invite" class="mt-5"><button class="rounded-xl border border-teal-800 px-4 py-2 font-semibold text-teal-900">Create parent invitation</button></form>
      {/if}
    {:else if data.step === 'children'}
      <h1 class="mt-2 text-3xl font-bold">Add your children</h1>
      <p class="mt-2">Each child can have their own chores and dashboard. Just add a name and set up a username and password whenever they’re ready.</p>
      <div class="mt-5"><ChildProfiles children={data.children} requestId={data.requestId} form={form && ('childError' in form || 'childMessage' in form) ? form : null} addAction="?/add" renameAction="?/rename" credentialsAction="?/credentials" /></div>
    {:else}
      <h1 class="mt-2 text-3xl font-bold">Try something together</h1>
      <p class="mt-2">Start with whatever would help today. Your setup progress stays here while you use the hub. Pick Continue family setup from your dashboard to come back.</p>
      <ul class="mt-6 grid gap-3 sm:grid-cols-2">
        {#if data.children.length}
          <li><a class="block rounded-xl border border-teal-200 p-4 font-semibold text-teal-900" href={resolve('/dashboard#add-chore')}>Create your first chore</a></li>
        {/if}
        <li><a class="block rounded-xl border border-teal-200 p-4 font-semibold text-teal-900" href={resolve('/groceries')}>Add groceries</a></li>
        <li><a class="block rounded-xl border border-teal-200 p-4 font-semibold text-teal-900" href={resolve('/meals')}>Plan tonight’s dinner</a></li>
        <li><a class="block rounded-xl border border-teal-200 p-4 font-semibold text-teal-900" href={resolve('/calendar')}>Add a family calendar event</a></li>
      </ul>
    {/if}

    <form aria-label="Continue family setup" method="POST" action="?/advance" class="mt-7 flex flex-wrap items-center gap-3 border-t border-teal-100 pt-5">
      <input type="hidden" name="step" value={data.step} />
      {#if data.step !== 'parents'}
        <button name="move" value="back" class="rounded-xl px-4 py-2 font-semibold text-teal-900">Back</button>
      {/if}
      <button name="move" value="next" class="rounded-xl bg-teal-800 px-5 py-3 font-semibold text-white">{data.step === 'activities' ? 'Go to our dashboard' : 'Continue'}</button>
      {#if data.step !== 'activities'}
        <button name="move" value="finish" class="rounded-xl px-4 py-2 text-sm font-semibold text-teal-900">Skip setup and go to dashboard</button>
      {/if}
    </form>
  </div>
</main>
