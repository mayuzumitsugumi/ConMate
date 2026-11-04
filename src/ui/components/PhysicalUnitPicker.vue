<script setup lang="ts">
import { computed, watch } from "vue";
import type { CatalogSnapshot } from "../../domain/models/catalog";
import { unitStates } from "../../domain/inventory/units";
const props = withDefaults(
  defineProps<{
    snapshot: CatalogSnapshot;
    productId: string;
    locationId: string;
    modelValue: string[];
    disabled?: boolean;
    excludedIds?: string[];
    label?: string;
  }>(),
  { disabled: false, excludedIds: () => [], label: "選擇實際交付單件" },
);
const emit = defineEmits<{ "update:modelValue": [value: string[]] }>();
const options = computed(() =>
  unitStates(props.snapshot).filter(
    (u) =>
      u.productId === props.productId &&
      u.locationId === props.locationId &&
      u.state === "available" &&
      !props.excludedIds.includes(u.unitId),
  ),
);
watch(
  () => [props.productId, props.locationId],
  () => emit("update:modelValue", []),
);
function toggle(id: string, checked: boolean) {
  emit(
    "update:modelValue",
    checked
      ? [...new Set([...props.modelValue, id])]
      : props.modelValue.filter((v) => v !== id),
  );
}
</script>
<template>
  <fieldset
    v-if="options.length || modelValue.length"
    class="physical-picker"
    :disabled="disabled"
  >
    <legend>{{ label }}</legend>
    <p>
      勾選實際處理的實物標記。已登記的單件不能只填數量略過選擇；勾選時數量須與選取件數一致，不能在同一項混用未登記實物；一般商品請另列一項。
    </p>
    <label v-for="u in options" :key="u.unitId" class="unit-option">
      <input
        type="checkbox"
        :checked="modelValue.includes(u.unitId)"
        @change="toggle(u.unitId, ($event.target as HTMLInputElement).checked)"
      />
      <span>{{ u.label }}</span>
    </label>
    <p
      v-if="modelValue.some((id) => !options.some((u) => u.unitId === id))"
      class="error-notice"
    >
      部分已選單件已不在此庫位或已被其他品項選取，請重新核對。
    </p>
    <small
      >已選
      {{ modelValue.length }} 件；總數量另填，系統會核對數量與批次。</small
    >
  </fieldset>
</template>
<style scoped>
.physical-picker {
  min-width: 0;
  border: 1px solid #b9c9b3;
  border-radius: 8px;
  padding: 12px;
  margin: 12px 0;
}
.physical-picker p {
  line-height: 1.8;
  font-size: 14px;
}
.unit-option {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  overflow-wrap: anywhere;
}
.unit-option input {
  width: 20px;
  height: 20px;
  flex: none;
}
small {
  line-height: 1.8;
}
</style>
