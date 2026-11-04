import type {
  CatalogSnapshot,
  CatalogItem,
  SaleInput,
  RefundInput,
  SalePlanInput,
} from "../models/catalog";
export interface HandoffInput {
  name: string;
  eventId: string;
  sourceLocationId: string;
  lines: { productId: string; quantity: number }[];
  planIds: string[];
  collectorIds: string[];
  financialReferences?: {
    kind:
      | "costs"
      | "advances"
      | "settlements"
      | "artworkExpenses"
      | "internalAgreements";
    id: string;
  }[];
}
export interface HandoffSource {
  productId: string;
  quantity: number;
  packetReceiptId: string;
  parentBatchId: string;
  parentTransferId: string;
}
export interface ActivityCashEntry {
  id: string;
  kind: "expense" | "handover" | "note" | "correction";
  amount: number;
  payerId: string;
  recipientId: string;
  reason: string;
  correctsId: string;
  createdAt: string;
}
export interface ActivityAddition {
  productId: string;
  receiptId: string;
  initialProduct: CatalogItem;
  quantity: number;
  reason: string;
}
export interface ActivityPriceRevision {
  id: string;
  planId: string;
  before: unknown;
  after: unknown;
  reason: string;
  createdAt: string;
}
export interface ActivityProductRevision {
  id: string;
  productId: string;
  beforeName: string;
  afterName: string;
  reason: string;
  createdAt: string;
}
export interface ActivityClosure {
  id: string;
  createdAt: string;
  counts: {
    productId: string;
    expected: number;
    actual: number;
    reason: string;
  }[];
  salesTotal: number;
  refundTotal: number;
  expensesTotal: number;
  notes: string;
}
export interface ActivityPacket {
  format: "ConMate活動專案";
  version: 1;
  handoffId: string;
  sourceWorkspaceId: string;
  sourceRevision: number;
  eventId: string;
  name: string;
  createdAt: string;
  revision: number;
  lineage: string[];
  draft: SaleInput["lines"];
  locationId: string;
  sources: HandoffSource[];
  baseline: CatalogSnapshot;
  snapshot: CatalogSnapshot;
  additions: ActivityAddition[];
  priceRevisions: ActivityPriceRevision[];
  productRevisions: ActivityProductRevision[];
  cashEntries: ActivityCashEntry[];
  financialReferences: {
    kind: string;
    id: string;
    name: string;
    data: unknown;
  }[];
  closure: ActivityClosure | null;
}
export interface HandoffRecord {
  id: string;
  name: string;
  eventId: string;
  locationId: string;
  createdAt: string;
  costVersionIds: string[];
  packet: ActivityPacket;
  localPacket?: ActivityPacket | null;
}
export interface ActivityMergeRecord {
  id: string;
  handoffId: string;
  closureId: string;
  packetContent: string;
  mergedAt: string;
  productMappings: Record<string, string>;
  planMappings: Record<string, string>;
  createdMovementIds: string[];
  reservationMovementOffset?: number;
  returnedAt: string;
}
export type ActivityCommand =
  | {
      type: "reserve";
      input: {
        planId: string;
        productId: string;
        locationId: string;
        quantity: number;
        reason: string;
      };
    }
  | { type: "release-reservation"; id: string; reason: string }
  | { type: "draft"; lines: SaleInput["lines"] }
  | { type: "sale"; input: SaleInput }
  | { type: "refund"; input: RefundInput }
  | { type: "cancel-sale"; id: string; reason: string }
  | { type: "rename-product"; id: string; name: string; reason: string }
  | {
      type: "decrease";
      productId: string;
      quantity: number;
      kind: "free" | "damage" | "adjust-out";
      reason: string;
    }
  | { type: "price"; input: SalePlanInput; id: string; reason: string }
  | { type: "add-product"; name: string; quantity: number; reason: string }
  | { type: "cash"; input: Omit<ActivityCashEntry, "id" | "createdAt"> };
