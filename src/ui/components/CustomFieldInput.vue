<script setup lang="ts">
import type { CustomField } from "../../domain/models/catalog";
type Value = string | number | boolean | string[] | null;
const props = defineProps<{
  field: CustomField;
  modelValue: Value | undefined;
  disabled?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: Value] }>();
function textValue(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  emit(
    "update:modelValue",
    props.field.type === "number"
      ? value === ""
        ? null
        : Number(value)
      : value,
  );
}
function toggle(id: string, checked: boolean) {
  const current = Array.isArray(props.modelValue) ? props.modelValue : [];
  emit(
    "update:modelValue",
    checked ? [...current, id] : current.filter((value) => value !== id),
  );
}
</script>
<template>
  <fieldset v-if="field.type === 'multi'" :disabled="disabled">
    <legend>{{ field.name }}</legend>
    <label
      v-for="option in field.options.filter(
        (o) =>
          !o.archived ||
          (Array.isArray(modelValue) && modelValue.includes(o.id)),
      )"
      :key="option.id"
      class="check-option"
    >
      <input
        type="checkbox"
        :checked="Array.isArray(modelValue) && modelValue.includes(option.id)"
        :disabled="option.archived"
        @change="toggle(option.id, ($event.target as HTMLInputElement).checked)"
      />{{ option.label }}{{ option.archived ? "（已封存）" : "" }}
    </label>
  </fieldset>
  <div v-else-if="field.type === 'boolean'" class="field">
    <label :for="`custom-${field.id}`">{{ field.name }}</label>
    <select
      :id="`custom-${field.id}`"
      :value="
        modelValue === true ? 'true' : modelValue === false ? 'false' : ''
      "
      :disabled="disabled"
      @change="
        emit(
          'update:modelValue',
          ($event.target as HTMLSelectElement).value === ''
            ? null
            : ($event.target as HTMLSelectElement).value === 'true',
        )
      "
    >
      <option value="">未指定</option>
      <option value="true">是</option>
      <option value="false">否</option>
    </select>
  </div>
  <div v-else class="field">
    <label :for="`custom-${field.id}`">{{ field.name }}</label>
    <select
      v-if="field.type === 'single'"
      :id="`custom-${field.id}`"
      :value="modelValue ?? ''"
      :disabled="disabled"
      @change="textValue"
    >
      <option value="">未指定</option>
      <option
        v-for="option in field.options.filter(
          (o) => !o.archived || modelValue === o.id,
        )"
        :key="option.id"
        :value="option.id"
        :disabled="option.archived"
      >
        {{ option.label }}{{ option.archived ? "（已封存）" : "" }}
      </option>
    </select>
    <input
      v-else
      :id="`custom-${field.id}`"
      :type="
        field.type === 'number'
          ? 'number'
          : field.type === 'date'
            ? 'date'
            : 'text'
      "
      :step="field.type === 'number' ? 'any' : undefined"
      :value="modelValue ?? ''"
      :disabled="disabled"
      @input="textValue"
    />
  </div>
</template>
<style scoped>
.field {
  display: grid;
  gap: 8px;
}
label,
legend {
  font-size: 14px;
}
input:not([type="checkbox"]),
select {
  width: 100%;
  min-height: 46px;
  padding: 10px;
  border: 1px solid #acbda8;
  border-radius: 7px;
  background: #fff;
  color: #253b34;
  font: inherit;
}
fieldset {
  border: 1px solid #dce4d6;
  border-radius: 8px;
  padding: 12px;
}
.check-option {
  display: flex;
  gap: 10px;
  align-items: center;
  min-height: 44px;
}
input[type="checkbox"] {
  width: 20px;
  height: 20px;
}
:focus-visible {
  outline: 3px solid #a6bd72;
  outline-offset: 3px;
}
</style>
