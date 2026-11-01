<script lang="ts">
  type Member = { id: string; name: string };
  type Initial = { id?: string; title?: string; date?: string; endDate?: string | null; startTime?: string | null; endTime?: string | null; allDay?: boolean; weekdays?: number[]; participants?: string[]; description?: string | null; location?: string | null; inbox?: string };
  let { initial, members, button, action }: { initial: Initial; members: Member[]; button: string; action: string } = $props();
  let title = $derived(initial.title ?? '');
  let date = $derived(initial.date ?? '');
  let endDate = $derived(initial.endDate ?? '');
  let startTime = $derived(initial.startTime ?? '');
  let endTime = $derived(initial.endTime ?? '');
  let description = $derived(initial.description ?? '');
  let location = $derived(initial.location ?? '');
  let allDay = $derived(initial.allDay ?? false);
  let weekdays = $derived(initial.weekdays ?? []);
  let participants = $derived(initial.participants ?? []);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
</script>
<form method="POST" {action} class="mt-4 grid gap-3">
  {#if initial.id}<input type="hidden" name="id" value={initial.id} />{/if}
  {#if initial.inbox}<input type="hidden" name="inbox" value={initial.inbox} />{/if}
  <label>Event title<input name="title" required maxlength="120" defaultValue={title} class="mt-1 block w-full rounded-lg border p-3" /></label>
  <label>Event date<input type="date" name="date" required bind:value={date} class="mt-1 block w-full rounded-lg border p-3" /></label>
  <label class="flex gap-2"><input type="checkbox" name="allDay" bind:checked={allDay} /> All day</label>
  <label>Start time<input type="time" name="startTime" bind:value={startTime} class="mt-1 block w-full rounded-lg border p-3" /></label>
  <label>End time<input type="time" name="endTime" bind:value={endTime} class="mt-1 block w-full rounded-lg border p-3" /></label>
  <label>Location (optional)<input name="location" maxlength="200" defaultValue={location} class="mt-1 block w-full rounded-lg border p-3" /></label>
  <label>Description (optional)<textarea name="description" maxlength="1000" bind:value={description} class="mt-1 block w-full rounded-lg border p-3"></textarea></label>
  <fieldset><legend>Repeat on (optional)</legend><div class="flex flex-wrap gap-3">{#each days as day, index (day)}<label class="flex items-center gap-2"><input type="checkbox" name="weekday" value={index} bind:group={weekdays} />{day}</label>{/each}</div></fieldset>
  <label>Repeat until (optional)<input type="date" name="endDate" bind:value={endDate} class="mt-1 block w-full rounded-lg border p-3" /></label>
  <fieldset><legend>Participants (optional)</legend><div class="flex flex-wrap gap-3">{#each members as member (member.id)}<label class="flex items-center gap-2"><input type="checkbox" name="participant" value={member.id} bind:group={participants} />{member.name}</label>{/each}</div></fieldset>
  <button class="rounded-xl bg-teal-700 px-4 py-3 font-bold text-white">{button}</button>
</form>
