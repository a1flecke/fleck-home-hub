<script lang="ts">
  let { initial }: { initial: { name: string; quantity: string; unit: string } } = $props();
  let name = $derived(initial.name), quantity = $derived(initial.quantity), unit = $derived(initial.unit);
</script>
<label>Item<input name="name" defaultValue={name} required maxlength="200" class="mt-1 block w-full rounded-lg border p-3" /></label>
<label>Quantity<input name="quantity" defaultValue={quantity} maxlength="60" class="mt-1 block w-full rounded-lg border p-3" /></label>
<label>Unit<input name="unit" defaultValue={unit} maxlength="60" class="mt-1 block w-full rounded-lg border p-3" /></label>
