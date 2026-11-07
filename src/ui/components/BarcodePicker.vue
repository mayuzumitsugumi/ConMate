<script setup lang="ts">
import { computed, ref } from "vue";
import type { CatalogItem } from "../../domain/models/catalog";
import { barcodeMatches } from "../../domain/catalog/product-media";
const props = defineProps<{ products: CatalogItem[]; disabled?: boolean }>();
const emit = defineEmits<{ select: [product: CatalogItem] }>();
const code = ref(""),
  submitted = ref("");
const matches = computed(() => barcodeMatches(props.products, submitted.value));
function scan() {
  submitted.value = code.value.trim();
  // Deliberately requires a visible selection, including a single match.
}
</script>
<template>
  <div class="business-panel">
    <label
      >條碼／商品代碼（掃碼槍或手動輸入）<input
        v-model="code"
        maxlength="80"
        :disabled="disabled"
        @keydown.enter.prevent="scan"
        @input="submitted = ''"
    /></label>
    <button
      type="button"
      class="button secondary"
      :disabled="disabled || !code.trim()"
      @click="scan"
    >
      查找條碼
    </button>
    <p>掃碼槍請以 Enter 結尾；只查找目前可選商品，選取後仍須確認售法與數量。</p>
    <template v-if="submitted">
      <p role="status">
        {{
          matches.length === 0
            ? "查無符合商品。"
            : matches.length > 1
              ? "條碼有多項符合，請明確選擇。"
              : "找到商品，請選取。"
        }}
      </p>
      <button
        v-for="p in matches"
        :key="p.id"
        type="button"
        class="button secondary"
        :disabled="disabled"
        @click="
          emit('select', p);
          submitted = '';
          code = '';
        "
      >
        {{ p.name }} · {{ p.code }}
      </button>
    </template>
  </div>
</template>
