<script lang="ts">
  import { resolve } from '$app/paths';
  import { viewHeading } from '../../lib/calendar/navigation';
  import type { PageData } from './$types';

  let { preparations }: { preparations: PageData['preparations'] } = $props();
</script>

{#if preparations.lists.length}
  <section aria-labelledby="getting-ready-heading" class="mt-6 rounded-2xl bg-white p-5 shadow-sm">
    <h2 id="getting-ready-heading" class="text-xl font-bold">Getting ready</h2>
    <ul class="mt-2 divide-y divide-teal-100">
      {#each preparations.lists as list (list.id)}
        <li class="py-3 last:pb-0">
          <h3 class="font-bold">
            <a class="inline-flex min-h-11 items-center break-words text-teal-800 underline" href={resolve('/lists/[id]?items=todo', { id: list.id })}>{list.name}</a>
          </h3>
          <p class="break-words text-sm text-slate-700">
            {#if list.eventTitle}
              <a class="font-semibold text-teal-800 underline" href={resolve(`/calendar?date=${list.date}&view=day`)}>{list.eventTitle}</a> ·
            {/if}
            <time datetime={list.date}>{viewHeading(list.date, 'day')}</time>
          </p>
          {#if list.progress}
            <p class="mt-2 text-sm font-semibold">{list.progress.completed} of {list.progress.total} items ready</p>
          {/if}
          {#if list.outstanding}
            <p class="mt-1 text-sm text-slate-700">{list.outstanding} {list.outstanding === 1 ? 'thing' : 'things'} still to do</p>
            <ul class="mt-1 list-disc space-y-1 pl-5 text-sm">
              {#each list.items as item, index (index)}<li class="break-words">{item}</li>{/each}
              {#if list.outstanding > list.items.length}<li>+{list.outstanding - list.items.length} more</li>{/if}
            </ul>
          {:else if list.progress?.total}
            <p class="mt-1 text-sm font-semibold text-teal-800">Everything is ready!</p>
          {:else}
            <p class="mt-1 text-sm text-slate-700">No items yet.</p>
          {/if}
        </li>
      {/each}
    </ul>
    {#if preparations.more}<a class="mt-2 inline-flex min-h-11 items-center font-semibold text-teal-800 underline" href={resolve('/lists')}>See all Family lists</a>{/if}
  </section>
{/if}
