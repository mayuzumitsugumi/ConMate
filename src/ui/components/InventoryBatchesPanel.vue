<script setup lang="ts">
import { computed } from "vue";
import { useCatalogStore } from "../../app/catalog-store";
import { batchBalances } from "../../domain/inventory/batches";
const catalog = useCatalogStore();
const rows = computed(() => {
  const s = catalog.snapshot;
  if (!s) return [];
  const state = batchBalances(s);
  return [...state.lots.values()]
    .flatMap((lot) =>
      s.locations.map((l) => ({
        lot,
        location: l.name,
        quantity: state.quantity(lot.id, l.id),
        product: s.products.find((p) => p.id === lot.productId)?.name || "",
      })),
    )
    .filter((r) => r.quantity > 0);
});
</script>
<template>
  <section class="section-block batches">
    <h2>入庫批次與 FIFO 配貨</h2>
    <p>
      每筆新增加庫存會建立獨立入庫批次。減少、調撥及銷售依原始入庫先後配貨，移動不重設順序；退款回到原銷售批次。名稱可相同，系統仍以穩定來源識別。
    </p>
    <p>
      舊紀錄統一標示「來源批次未指定」，不推定製造來源。這是數量追蹤，不會連動成本表、推算歷史成本或已售成本；新增批次也不重複入庫。
    </p>
    <div class="batch-list">
      <article v-for="r in rows" :key="r.lot.id + ':' + r.location">
        <strong>{{ r.product }} · {{ r.lot.name }}</strong>
        <p>{{ r.location }}：{{ r.quantity }} 件</p>
        <small v-if="r.lot.sourceMovementId"
          >入庫紀錄：{{ r.lot.sourceCode }}</small
        >
      </article>
      <p v-if="!rows.length">目前沒有有餘額的入庫批次。</p>
    </div>
  </section>
</template>
<style scoped>
.batches {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 20px;
}
.batches p {
  line-height: 1.9;
}
.batch-list {
  display: grid;
  gap: 12px;
}
.batch-list article {
  border: 1px solid var(--line);
  padding: 14px;
  border-radius: 8px;
  overflow-wrap: anywhere;
}
.batch-list small {
  color: #58674f;
}
</style>
