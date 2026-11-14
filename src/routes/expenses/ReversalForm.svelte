<script lang="ts">
  let { action, id, initial }: { action: string; id: string; initial: string } = $props();
  let reason = $derived(initial);
</script>

<form method="POST" {action} aria-label="Reverse recorded payment" class="mt-2 grid gap-3">
  <input type="hidden" name="id" value={id} />
  <label>Reason<textarea name="reason" required maxlength="1000" bind:value={reason} class="mt-1 block w-full rounded-lg border border-stone-400 bg-white p-3"></textarea></label>
  <button class="justify-self-start rounded-xl border border-teal-700 px-4 py-3 font-semibold text-teal-800">Confirm reversal</button>
</form>
