<script lang="ts">
  import Disclosure from '../../calendar/Disclosure.svelte';
  import { WARNING_LABELS, type DuplicateMatch, type ImportReviewItem } from '../../../lib/calendar/ics';

  type Member = { id: string; name: string };
  let { item, index, members }: { item: ImportReviewItem; index: number; members: Member[] } = $props();

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let description = $derived(item.description);
  let hasDetails = $derived(Boolean(
    item.location
    || item.description
    || item.weekdays.length
    || item.endDate
    || item.participants.length
    || item.warnings.includes('unsupported_rrule')
  ));

  function existingDescription(match: DuplicateMatch): string {
    const time = match.allDay ? 'All day' : `${match.startTime ?? ''}–${match.endTime ?? ''}`;
    return `${match.title} (${match.date}, ${time})`;
  }
</script>

<fieldset class="rounded-xl border border-slate-200 p-4" data-key={item.key}>
  <legend class="px-1 font-bold">Event {index + 1}: {item.originalSummary}</legend>
  <input type="hidden" name={`key-${index}`} value={item.key} />
  <input type="hidden" name={`uid-${index}`} value={item.sourceUid ?? ''} />
  <input type="hidden" name={`summary-${index}`} value={item.originalSummary} />
  {#each item.warnings as warning (warning)}
    <input type="hidden" name={`warning-${index}`} value={warning} />
  {/each}

  {#if item.existing}
    <p class="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
      {item.existing.kind === 'uid' ? 'Already imported:' : 'Matches an existing event:'} {existingDescription(item.existing)}. Skipped by default so existing events are never overwritten.
    </p>
  {/if}
  {#if item.duplicateOfBatch}
    <p class="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
      Matches an earlier event in this import. Skipped by default.
    </p>
  {/if}
  {#each item.warnings as warning (warning)}
    <p class="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{WARNING_LABELS[warning]}</p>
  {/each}

  <div class="mt-3 grid gap-3 sm:grid-cols-2">
    <label class="block sm:col-span-2">
      Event title
      <input name={`title-${index}`} defaultValue={item.title} maxlength="120" class="mt-1 block w-full rounded-lg border p-3" />
    </label>
    <label class="block">
      Event date
      <input type="date" name={`date-${index}`} defaultValue={item.date} class="mt-1 block w-full rounded-lg border p-3" />
    </label>
    <label class="flex min-h-11 items-center gap-3 self-end py-2">
      <input type="checkbox" name={`allDay-${index}`} value="on" defaultChecked={item.allDay} class="h-5 w-5" />
      All day
    </label>
    <label class="block">
      Start time
      <input type="time" name={`startTime-${index}`} defaultValue={item.startTime} class="mt-1 block w-full rounded-lg border p-3" />
    </label>
    <label class="block">
      End time
      <input type="time" name={`endTime-${index}`} defaultValue={item.endTime} class="mt-1 block w-full rounded-lg border p-3" />
    </label>
  </div>

  <Disclosure class="mt-3 rounded-lg bg-slate-50 p-3" expanded={hasDetails}>
    <summary class="cursor-pointer font-semibold">Details, repeat schedule, and participants</summary>
    <div class="mt-3 grid gap-3">
      <label class="block">
        Location (optional)
        <input name={`location-${index}`} defaultValue={item.location} maxlength="200" class="mt-1 block w-full rounded-lg border bg-white p-3" />
      </label>
      <label class="block">
        Description (optional)
        <textarea name={`description-${index}`} rows="3" maxlength="1000" bind:value={description} class="mt-1 block w-full rounded-lg border bg-white p-3"></textarea>
      </label>
      <fieldset>
        <legend class="font-semibold">Repeat on (optional)</legend>
        <div class="mt-2 flex flex-wrap gap-3">
          {#each days as day, dayIndex (day)}
            <label class="flex min-h-10 items-center gap-2">
              <input type="checkbox" name={`weekday-${index}`} value={dayIndex} defaultChecked={item.weekdays.includes(dayIndex)} class="h-5 w-5" />
              {day}
            </label>
          {/each}
        </div>
      </fieldset>
      <label class="block">
        Repeat until (optional)
        <input type="date" name={`endDate-${index}`} defaultValue={item.endDate} class="mt-1 block w-full rounded-lg border bg-white p-3" />
      </label>
      {#if members.length}
        <fieldset>
          <legend class="font-semibold">Participants (optional)</legend>
          <div class="mt-2 flex flex-wrap gap-3">
            {#each members as member (member.id)}
              <label class="flex min-h-10 items-center gap-2">
                <input type="checkbox" name={`participant-${index}`} value={member.id} defaultChecked={item.participants.includes(member.id)} class="h-5 w-5" />
                {member.name}
              </label>
            {/each}
          </div>
        </fieldset>
      {/if}
    </div>
  </Disclosure>

  <fieldset class="mt-4">
    <legend class="font-semibold">Decision</legend>
    {#if item.existing || item.duplicateOfBatch}
      <label class="flex min-h-11 items-center gap-3">
        <input type="radio" name={`action-${index}`} value="keep_duplicate" defaultChecked={item.action === 'keep_duplicate'} class="h-5 w-5" />
        Import as separate event
      </label>
      <label class="flex min-h-11 items-center gap-3">
        <input type="radio" name={`action-${index}`} value="skip" defaultChecked={item.action !== 'keep_duplicate'} class="h-5 w-5" />
        Skip this event
      </label>
    {:else}
      <label class="flex min-h-11 items-center gap-3">
        <input type="radio" name={`action-${index}`} value="import" defaultChecked={item.action === 'import' || item.action === 'keep_duplicate'} class="h-5 w-5" />
        Import this event
      </label>
      <label class="flex min-h-11 items-center gap-3">
        <input type="radio" name={`action-${index}`} value="skip" defaultChecked={item.action === 'skip'} class="h-5 w-5" />
        Skip this event
      </label>
    {/if}
  </fieldset>
</fieldset>
