<script setup lang="ts">
import { computed } from "vue";
import type { CatalogSnapshot } from "../../domain/models/catalog";
const props = defineProps<{
  snapshot: CatalogSnapshot;
  saleLineId: string;
  restockUnitIds: string[];
  damagedUnitIds: string[];
  disabled?: boolean;
}>();
const emit = defineEmits<{
  "update:restockUnitIds": [value: string[]];
  "update:damagedUnitIds": [value: string[]];
}>();
const originalIds = computed(
  () =>
    props.snapshot.sales
      .flatMap((s) => s.lines)
      .find((l) => l.id === props.saleLineId)?.unitIds || [],
);
const options = computed(() => {
  const returned = new Set(
    props.snapshot.refunds.flatMap((r) =>
      r.lines
        .filter((l) => l.saleLineId === props.saleLineId)
        .flatMap((l) => [
          ...(l.restockUnitIds || []),
          ...(l.damagedUnitIds || []),
        ]),
    ),
  );
  return originalIds.value
    .filter((id) => !returned.has(id))
    .map((id) => ({
      id,
      label: props.snapshot.physicalUnits.find((u) => u.id === id)?.label || id,
    }));
});
function toggle(kind: "restock" | "damaged", id: string, checked: boolean) {
  const ids = kind === "restock" ? props.restockUnitIds : props.damagedUnitIds;
  const value = checked
    ? [...new Set([...ids, id])]
    : ids.filter((v) => v !== id);
  if (kind === "restock") emit("update:restockUnitIds", value);
  else emit("update:damagedUnitIds", value);
}
</script>
<template>
  <fieldset v-if="originalIds.length" class="unit-returns" :disabled="disabled">
    <legend>選擇實際退回的特殊單件</legend>
    <p>
      只退款、不退實物時不用勾選。同一件不能同時可售回庫及損壞退回；回庫數量依所選件數填寫。
    </p>
    <div v-for="u in options" :key="u.id" class="return-row">
      <strong>{{ u.label }}</strong>
      <label
        ><input
          type="checkbox"
          :checked="restockUnitIds.includes(u.id)"
          :disabled="disabled || damagedUnitIds.includes(u.id)"
          @change="
            toggle('restock', u.id, ($event.target as HTMLInputElement).checked)
          "
        />可售回庫</label
      >
      <label
        ><input
          type="checkbox"
          :checked="damagedUnitIds.includes(u.id)"
          :disabled="disabled || restockUnitIds.includes(u.id)"
          @change="
            toggle('damaged', u.id, ($event.target as HTMLInputElement).checked)
          "
        />損壞退回</label
      >
    </div>
    <p v-if="!options.length">這筆交易的特殊單件已全部登記退回。</p>
  </fieldset>
</template>
<style scoped>
.unit-returns {
  min-width: 0;
  border: 1px solid #b9c9b3;
  border-radius: 8px;
  padding: 12px;
  margin: 12px 0;
}
p {
  font-size: 14px;
  line-height: 1.8;
}
.return-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  align-items: center;
  border-bottom: 1px solid var(--line);
  padding: 8px 0;
  overflow-wrap: anywhere;
}
label {
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 8px;
}
input {
  width: 20px;
  height: 20px;
}
</style>
