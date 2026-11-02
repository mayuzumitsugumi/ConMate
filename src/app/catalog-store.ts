import {
  putArtworkExpense,
  applyArtworkAllocation,
  reverseArtworkAllocation,
  voidArtworkExpense,
} from "../domain/finance/artwork";
import {
  putExpensePayment,
  reverseExpensePayment,
} from "../domain/finance/payments";
import type {
  ArtworkExpenseInput,
  ArtworkAllocationInput,
  ExpensePaymentInput,
} from "../domain/models/catalog";
import { putProductNames } from "../domain/catalog/bulk";
import { refundSale as putRefund } from "../domain/sales/refunds";
import type { RefundInput } from "../domain/models/catalog";
import {
  beginStocktake,
  saveStocktakeCounts,
  finishStocktake,
} from "../domain/inventory/stocktake";
import type { StocktakeCountInput } from "../domain/models/catalog";
import { putSalePlan, toggleSalePlanArchive } from "../domain/sales/plans";
import type { SalePlanInput } from "../domain/models/catalog";
import { completeSale, cancelSale } from "../domain/sales/operations";
import {
  putCost,
  putAdvance,
  repayAdvance,
  reverseRepayment as undoRepayment,
  voidAdvance as cancelAdvance,
} from "../domain/finance/operations";
import type {
  SaleInput,
  CostInput,
  AdvanceInput,
} from "../domain/models/catalog";
import {
  putOnlineListing,
  toggleOnlineListing,
} from "../domain/inventory/online";
import type { OnlineListingInput } from "../domain/models/catalog";
import {
  addLocation,
  addMovement,
  reverseMovement,
  putMovementType,
  toggleMovementType,
} from "../domain/inventory/operations";
import type { MovementInput, StockEffect } from "../domain/models/catalog";
import {
  putProject,
  putEvent,
  toggleProjectArchive,
  toggleEventArchive,
} from "../domain/catalog/projects";
import { defineStore } from "pinia";
import { ref } from "vue";
import { catalogRepository } from "../infrastructure/storage/catalog";
import {
  putProduct,
  putTag,
  putField,
  SUGGESTED_TAGS,
} from "../domain/catalog/operations";
import type {
  CatalogSnapshot,
  FieldInput,
  ProductInput,
  ProjectInput,
  EventInput,
} from "../domain/models/catalog";
export const useCatalogStore = defineStore("catalog", () => {
  const snapshot = ref<CatalogSnapshot | null>(null),
    busy = ref(false),
    error = ref("");
  let request = 0;
  async function load(workspaceId: string) {
    const current = ++request;
    snapshot.value = null;
    error.value = "";
    if (!workspaceId) return;
    try {
      const next = await catalogRepository.read(workspaceId);
      if (current === request) snapshot.value = next;
    } catch (e) {
      if (current === request)
        error.value = e instanceof Error ? e.message : "無法讀取本機資料。";
    }
  }
  async function mutate(operation: (s: CatalogSnapshot) => void) {
    if (busy.value) throw new Error("正在儲存，請稍候。");
    const previous = snapshot.value;
    if (!previous) throw new Error("請先選擇並載入工作區。");
    busy.value = true;
    error.value = "";
    try {
      const next = await catalogRepository.change(
        previous.workspaceId,
        previous.revision,
        operation,
      );
      if (snapshot.value?.workspaceId === previous.workspaceId)
        snapshot.value = next;
    } catch (e) {
      error.value =
        e instanceof Error ? e.message : "儲存失敗，原始資料未更動。";
      throw new Error(error.value);
    } finally {
      busy.value = false;
    }
  }
  const saveProduct = (input: ProductInput, id?: string) =>
    mutate((s) => {
      putProduct(s, input, id);
    });
  const archiveProduct = (id: string) =>
    mutate((s) => {
      const p = s.products.find((p) => p.id === id);
      if (!p) throw new Error("找不到商品。");
      p.archived = !p.archived;
      p.updatedAt = new Date().toISOString();
    });
  const saveTag = (name: string, id?: string) =>
    mutate((s) => putTag(s, name, id));
  const archiveTag = (id: string) =>
    mutate((s) => {
      const t = s.tags.find((t) => t.id === id);
      if (!t) throw new Error("找不到標記。");
      t.archived = !t.archived;
    });
  const saveField = (input: FieldInput, id?: string) =>
    mutate((s) => putField(s, input, id));
  const archiveField = (id: string) =>
    mutate((s) => {
      const f = s.fields.find((f) => f.id === id);
      if (!f) throw new Error("找不到欄位。");
      f.archived = !f.archived;
    });
  const addSuggestedTags = () =>
    mutate((s) => {
      for (const name of SUGGESTED_TAGS)
        if (!s.tags.some((t) => t.name === name)) putTag(s, name);
    });
  const saveProject = (input: ProjectInput, id?: string) =>
    mutate((s) => {
      putProject(s, input, id);
    });
  const saveEvent = (input: EventInput, id?: string) =>
    mutate((s) => {
      putEvent(s, input, id);
    });
  const archiveProject = (id: string) =>
    mutate((s) => toggleProjectArchive(s, id));
  const archiveEvent = (id: string) => mutate((s) => toggleEventArchive(s, id));
  const saveLocation = (name: string) =>
    mutate((s) => {
      addLocation(s, name);
    });
  const saveMovement = (input: MovementInput) =>
    mutate((s) => {
      addMovement(s, input);
    });
  const cancelMovement = (id: string, reason: string) =>
    mutate((s) => {
      reverseMovement(s, id, reason);
    });
  const saveOnlineListing = (input: OnlineListingInput, id?: string) =>
    mutate((s) => {
      putOnlineListing(s, input, id);
    });
  const archiveOnlineListing = (id: string) =>
    mutate((s) => {
      toggleOnlineListing(s, id);
    });
  const saveMovementType = (name: string, effect: StockEffect, id?: string) =>
    mutate((s) => {
      putMovementType(s, name, effect, id);
    });
  const archiveMovementType = (id: string) =>
    mutate((s) => toggleMovementType(s, id));
  const finishSale = (input: SaleInput) =>
    mutate((s) => {
      completeSale(s, input);
    });
  const refundSale = (id: string, reason: string) =>
    mutate((s) => cancelSale(s, id, reason));
  const saveCost = (input: CostInput, id?: string) =>
    mutate((s) => putCost(s, input, id));
  const archiveCost = (id: string) =>
    mutate((s) => {
      const c = s.costs.find((c) => c.id === id);
      if (!c) throw new Error("找不到成本紀錄。");
      c.archived = !c.archived;
    });
  const saveAdvance = (input: AdvanceInput) =>
    mutate((s) => putAdvance(s, input));
  const payAdvance = (id: string, amount: number, notes: string) =>
    mutate((s) => repayAdvance(s, id, amount, notes));
  const reverseRepayment = (id: string, repaymentId: string, reason: string) =>
    mutate((s) => undoRepayment(s, id, repaymentId, reason));
  const voidAdvance = (id: string, reason: string) =>
    mutate((s) => cancelAdvance(s, id, reason));
  const saveSalePlan = (input: SalePlanInput, id?: string) =>
    mutate((s) => {
      putSalePlan(s, input, id);
    });
  const archiveSalePlan = (id: string) =>
    mutate((s) => {
      toggleSalePlanArchive(s, id);
    });
  const startStocktake = (input: {
    name: string;
    locationId: string;
    eventId: string;
    notes: string;
  }) =>
    mutate((s) => {
      beginStocktake(
        s,
        input.locationId,
        input.eventId,
        input.name,
        input.notes,
      );
    });
  const updateStocktake = (id: string, inputs: StocktakeCountInput[]) =>
    mutate((s) => saveStocktakeCounts(s, id, inputs));
  const closeStocktake = (id: string, inputs: StocktakeCountInput[]) =>
    mutate((s) => {
      saveStocktakeCounts(s, id, inputs);
      finishStocktake(s, id);
    });
  const recordRefund = (input: RefundInput) =>
    mutate((s) => {
      putRefund(s, input);
    });
  const bulkSaveProducts = (names: string[]) =>
    mutate((s) => {
      putProductNames(s, names);
    });
  const createArtworkExpense = (input: ArtworkExpenseInput) =>
    mutate((s) => {
      putArtworkExpense(s, input);
    });
  const allocateArtwork = (id: string, input: ArtworkAllocationInput) =>
    mutate((s) => {
      applyArtworkAllocation(s, id, input);
    });
  const undoArtworkAllocation = (id: string, reason: string) =>
    mutate((s) => reverseArtworkAllocation(s, id, reason));
  const cancelArtworkExpense = (id: string, reason: string) =>
    mutate((s) => voidArtworkExpense(s, id, reason));
  const recordExpensePayment = (input: ExpensePaymentInput) =>
    mutate((s) => {
      putExpensePayment(s, input);
    });
  const undoExpensePayment = (id: string, reason: string) =>
    mutate((s) => reverseExpensePayment(s, id, reason));
  return {
    createArtworkExpense,
    allocateArtwork,
    undoArtworkAllocation,
    cancelArtworkExpense,
    recordExpensePayment,
    undoExpensePayment,
    bulkSaveProducts,
    recordRefund,
    startStocktake,
    updateStocktake,
    closeStocktake,
    saveSalePlan,
    archiveSalePlan,
    finishSale,
    refundSale,
    saveCost,
    archiveCost,
    saveAdvance,
    payAdvance,
    reverseRepayment,
    voidAdvance,
    saveMovementType,
    archiveMovementType,
    saveOnlineListing,
    archiveOnlineListing,
    saveLocation,
    saveMovement,
    cancelMovement,
    saveProject,
    saveEvent,
    archiveProject,
    archiveEvent,
    snapshot,
    busy,
    error,
    load,
    saveProduct,
    archiveProduct,
    saveTag,
    archiveTag,
    saveField,
    archiveField,
    addSuggestedTags,
  };
});
