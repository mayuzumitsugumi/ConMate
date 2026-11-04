import { completeExchange } from "../domain/sales/exchanges";
import type { ExchangeInput } from "../domain/models/catalog";
import { registerPhysicalUnits } from "../domain/inventory/units";
import {
  reserveStock,
  releaseReservation,
} from "../domain/inventory/reservations";
import {
  createInternalAgreement as putInternalAgreement,
  recordInternalReceipt as putInternalReceipt,
  reverseInternalReceipt as undoInternalReceipt,
  voidInternalAgreement as cancelInternalAgreement,
} from "../domain/finance/internal-pricing";
import type {
  InternalAgreementInput,
  InternalReceiptInput,
} from "../domain/models/catalog";
import { saveBatchCost as putBatchCost } from "../domain/finance/batch-costs";
import {
  putParty,
  putArtwork,
  togglePartyArchive,
  toggleArtworkArchive,
} from "../domain/catalog/masterdata";
import type { PartyInput, ArtworkInput } from "../domain/models/catalog";
import {
  recordSettlementCash as putSettlementCash,
  reverseSettlementCash as undoSettlementCash,
  reopenSettlement as reopenSettlementGroup,
  createSettlement as createSettlementGroup,
  closeSettlement as closeSettlementGroup,
  recordSettlementTrial as putSettlementTrial,
  decideSettlement as putSettlementDecision,
  paySettlement as putSettlementPayment,
  reverseSettlementPayment as undoSettlementPayment,
  setSettlementHoldings as declareSettlementHoldings,
} from "../domain/finance/settlements";
import type {
  SettlementCashInput,
  SettlementTrialInput,
  SettlementDecisionInput,
  SettlementPaymentInput,
  SettlementHolding,
} from "../domain/models/catalog";
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
  const reserveInventory = (input: {
    planId: string;
    productId: string;
    locationId: string;
    quantity: number;
    reason: string;
  }) =>
    mutate((s) => {
      reserveStock(s, input);
    });
  const releaseInventoryReservation = (id: string, reason: string) =>
    mutate((s) => {
      releaseReservation(s, id, reason);
    });
  const saveProduct = (input: ProductInput, id?: string) =>
    mutate((s) => {
      putProduct(s, input, id);
    });
  const archiveProduct = (id: string) =>
    mutate((s) => {
      const p = s.products.find((p) => p.id === id);
      if (!p) throw new Error("找不到商品。");
      if (
        !p.archived &&
        s.inventoryReservations.some(
          (r) => !r.releasedAt && r.productId === p.id,
        )
      )
        throw new Error("封存商品前請先明確釋放專用預留。");
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
  const exchangeSale = (input: ExchangeInput) =>
    mutate((s) => {
      completeExchange(s, input);
    });
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
  const recordSettlementCash = (id: string, input: SettlementCashInput) =>
    mutate((s) => {
      putSettlementCash(s, id, input);
    });
  const reverseSettlementCash = (
    id: string,
    adjustmentId: string,
    reason: string,
  ) =>
    mutate((s) => {
      undoSettlementCash(s, id, adjustmentId, reason);
    });
  const reopenSettlement = (id: string, reason: string) =>
    mutate((s) => {
      reopenSettlementGroup(s, id, reason);
    });
  const createSettlement = (name: string, notes: string) =>
    mutate((s) => {
      createSettlementGroup(s, name, notes);
    });
  const closeSettlement = (id: string, reason: string) =>
    mutate((s) => {
      closeSettlementGroup(s, id, reason);
    });
  const recordSettlementTrial = (id: string, input: SettlementTrialInput) =>
    mutate((s) => {
      putSettlementTrial(s, id, input);
    });
  const decideSettlement = (id: string, input: SettlementDecisionInput) =>
    mutate((s) => {
      putSettlementDecision(s, id, input);
    });
  const paySettlement = (id: string, input: SettlementPaymentInput) =>
    mutate((s) => {
      putSettlementPayment(s, id, input);
    });
  const reverseSettlementPayment = (
    id: string,
    paymentId: string,
    reason: string,
  ) =>
    mutate((s) => {
      undoSettlementPayment(s, id, paymentId, reason);
    });
  const setSettlementHoldings = (id: string, input: SettlementHolding[]) =>
    mutate((s) => {
      declareSettlementHoldings(s, id, input);
    });
  const saveParty = (input: PartyInput, id?: string) =>
    mutate((s) => {
      putParty(s, input, id);
    });
  const archiveParty = (id: string) => mutate((s) => togglePartyArchive(s, id));
  const saveArtwork = (input: ArtworkInput, id?: string) =>
    mutate((s) => {
      putArtwork(s, input, id);
    });
  const archiveArtwork = (id: string) =>
    mutate((s) => toggleArtworkArchive(s, id));
  const saveBatchCost = (batchId: string, costId: string, notes: string) =>
    mutate((s) => {
      putBatchCost(s, batchId, costId, notes);
    });
  const createInternalAgreement = (
    input: InternalAgreementInput,
    previousId = "",
  ) =>
    mutate((s) => {
      putInternalAgreement(s, input, previousId);
    });
  const recordInternalReceipt = (input: InternalReceiptInput) =>
    mutate((s) => {
      putInternalReceipt(s, input);
    });
  const reverseInternalReceipt = (id: string, reason: string) =>
    mutate((s) => {
      undoInternalReceipt(s, id, reason);
    });
  const voidInternalAgreement = (id: string, reason: string) =>
    mutate((s) => {
      cancelInternalAgreement(s, id, reason);
    });
  const registerUnits = (input: Parameters<typeof registerPhysicalUnits>[1]) =>
    mutate((s) => {
      registerPhysicalUnits(s, input);
    });
  return {
    registerUnits,
    reserveInventory,
    releaseInventoryReservation,
    createInternalAgreement,
    recordInternalReceipt,
    reverseInternalReceipt,
    voidInternalAgreement,
    saveBatchCost,
    saveParty,
    archiveParty,
    saveArtwork,
    archiveArtwork,
    recordSettlementCash,
    reverseSettlementCash,
    reopenSettlement,
    createSettlement,
    closeSettlement,
    recordSettlementTrial,
    decideSettlement,
    paySettlement,
    reverseSettlementPayment,
    setSettlementHoldings,
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
    exchangeSale,
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
