import type { Workspace } from "./workspace";
export type CustomValue = string | number | boolean | string[] | null;
export type FieldType =
  "text" | "number" | "single" | "multi" | "boolean" | "date";
export interface NamedRecord {
  id: string;
  workspaceId: string;
  code: string;
  name: string;
}
export interface CatalogTag extends NamedRecord {
  archived: boolean;
}
export interface FieldOption {
  id: string;
  label: string;
  archived: boolean;
}
export interface CustomField extends NamedRecord {
  type: FieldType;
  options: FieldOption[];
  archived: boolean;
}
export interface CatalogItem extends NamedRecord {
  creatorId: string;
  projectId: string;
  typeId: string;
  seriesId: string;
  specId: string;
  specification: string;
  artwork: string;
  artworkId?: string;
  notes: string;
  tagIds: string[];
  customValues: Record<string, CustomValue>;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface CatalogProject extends NamedRecord {
  description: string;
  archived: boolean;
}
export interface CatalogEvent extends NamedRecord {
  startDate: string;
  endDate: string;
  venue: string;
  notes: string;
  archived: boolean;
}
export interface ProjectEventLink extends NamedRecord {
  projectId: string;
  eventId: string;
}
export interface ProjectInput {
  name: string;
  description: string;
}
export interface EventInput {
  name: string;
  startDate: string;
  endDate: string;
  venue: string;
  notes: string;
  projectIds: string[];
}
export interface CatalogSnapshot {
  schemaVersion: 11;
  workspaceId: string;
  workspace: Workspace;
  revision: number;
  counters: Record<string, number>;
  parties: NamedRecord[];
  projects: CatalogProject[];
  events: CatalogEvent[];
  projectEvents: ProjectEventLink[];
  productTypes: NamedRecord[];
  specs: (NamedRecord & { typeId: string })[];
  series: (NamedRecord & { projectId: string; typeId: string })[];
  artworks: (NamedRecord & { projectId: string })[];
  products: CatalogItem[];
  tags: CatalogTag[];
  fields: CustomField[];
  locations: NamedRecord[];
  movements: InventoryMovement[];
  movementTypes: InventoryMovementType[];
  onlineListings: OnlineListing[];
  sales: SaleRecord[];
  salePlans: SalePlan[];
  stocktakes: StocktakeRecord[];
  refunds: RefundRecord[];
  costs: CostRecord[];
  advances: AdvanceRecord[];
  artworkExpenses: ArtworkExpenseRecord[];
  expensePayments: ExpensePaymentRecord[];
}
export interface ProductInput {
  name: string;
  creatorId?: string;
  creatorName?: string;
  projectId?: string;
  projectName?: string;
  productType: string;
  specification: string;
  artwork: string;
  notes: string;
  tagIds: string[];
  customValues: Record<string, CustomValue>;
}
export interface FieldInput {
  name: string;
  type: FieldType;
  options: { id?: string; label: string; archived?: boolean }[];
}

export type MovementKind =
  | "receipt"
  | "free"
  | "damage"
  | "adjust-in"
  | "adjust-out"
  | "transfer"
  | "reversal"
  | "sale"
  | "refund-return";
export interface InventoryMovement extends NamedRecord {
  productId: string;
  kind: MovementKind;
  movementTypeId?: string;
  saleId?: string;
  refundId?: string;
  quantity: number;
  fromLocationId: string;
  toLocationId: string;
  reason: string;
  createdAt: string;
  reversesId: string;
}
export interface MovementInput {
  productId: string;
  kind: Exclude<MovementKind, "reversal" | "sale" | "refund-return">;
  movementTypeId?: string;
  quantity: number;
  fromLocationId: string;
  toLocationId: string;
  reason: string;
}

export interface OnlineListing extends NamedRecord {
  productId: string;
  locationId: string;
  url: string;
  quantity: number;
  checkedAt: string;
  notes: string;
  archived: boolean;
}
export interface OnlineListingInput {
  name: string;
  productId: string;
  locationId: string;
  url: string;
  quantity: number;
  notes: string;
}

export type StockEffect = "increase" | "decrease" | "transfer";
export interface InventoryMovementType extends NamedRecord {
  effect: StockEffect;
  archived: boolean;
}

export interface SalePlanInput {
  name: string;
  mode: "direct" | "draw";
  unitPrice: number;
  productIds: string[];
  eventIds: string[];
}
export interface SalePlan extends NamedRecord, SalePlanInput {
  version: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface SaleLineInput {
  planId?: string;
  planVersion?: number;
  productId: string;
  mode: "direct" | "draw";
  quantity: number;
  unitPrice: number;
}
export interface SaleInput {
  replacesRefundId?: string;
  operationId: string;
  locationId: string;
  eventId: string;
  collectorId: string;
  cashReceived: number;
  notes: string;
  lines: SaleLineInput[];
}
export interface SaleLine extends SaleLineInput {
  id: string;
  productName: string;
  planName?: string;
  movementId: string;
}
export interface SaleRecord extends NamedRecord {
  replacesRefundId?: string;
  operationId: string;
  locationId: string;
  eventId: string;
  collectorId: string;
  cashReceived: number;
  total: number;
  change: number;
  notes: string;
  createdAt: string;
  cancelledAt: string;
  cancelReason: string;
  lines: SaleLine[];
  reversalIds: string[];
}
export interface CostInput {
  name: string;
  productId: string;
  quantity: number;
  estimatedPrint: number | null;
  actualPrint: number | null;
  artworkAllocated: number | null;
  otherCost: number | null;
  unitSalePrice: number | null;
  paidById: string;
  burdenPartyId: string;
  notes: string;
}
export interface CostRecord extends NamedRecord, CostInput {
  artworkAllocation?: ManagedArtworkAllocation;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface AdvanceInput {
  name: string;
  payerId: string;
  debtorId: string;
  principal: number;
  notes: string;
}
export interface RepaymentRecord {
  id: string;
  amount: number;
  notes: string;
  createdAt: string;
  reversesId: string;
}
export interface AdvanceRecord extends NamedRecord, AdvanceInput {
  createdAt: string;
  voidedAt: string;
  voidReason: string;
  repayments: RepaymentRecord[];
}

export interface StocktakeLine {
  productId: string;
  productName: string;
  expected: number;
  actual: number | null;
  action: "pending" | "adjust";
  reason: string;
  adjustmentMovementId: string;
}
export interface StocktakeRecord extends NamedRecord {
  locationId: string;
  eventId: string;
  notes: string;
  createdAt: string;
  completedAt: string;
  cutoffMovementCount: number;
  staleAtCompletion: boolean;
  completionMovementCount: number | null;
  lines: StocktakeLine[];
}
export interface StocktakeCountInput {
  productId: string;
  actual: number | null;
  action: "pending" | "adjust";
  reason: string;
}

export interface RefundLineInput {
  saleLineId: string;
  amount: number;
  restockQuantity: number;
  damagedQuantity: number;
  returnLocationId: string;
}
export interface RefundInput {
  operationId: string;
  saleId: string;
  reason: string;
  lines: RefundLineInput[];
}
export interface RefundLine extends RefundLineInput {
  id: string;
  movementId: string;
}
export interface RefundRecord extends NamedRecord {
  operationId: string;
  saleId: string;
  reason: string;
  createdAt: string;
  total: number;
  lines: RefundLine[];
}

export interface ExactFraction {
  numerator: string;
  denominator: string;
}
export type ArtworkAllocationMethod =
  "unit-print" | "total-print" | "equal" | "custom" | "manual";
export interface ArtworkAllocationTargetInput {
  costId: string;
  weight: string;
  manualAmount: number | null;
}
export interface ArtworkAllocationInput {
  method: ArtworkAllocationMethod;
  basis: "actual" | "estimated";
  targets: ArtworkAllocationTargetInput[];
  allowReplaceManual: boolean;
}
export interface ArtworkTargetSnapshot {
  costId: string;
  productId: string;
  quantity: number;
  printTotal: number | null;
  weight: string;
  manualAmount: number | null;
  exactAmount: ExactFraction;
  integerAmount: number;
  previousAmount: number | null;
}
export interface ArtworkAllocationVersion {
  version: number;
  method: ArtworkAllocationMethod;
  basis: "actual" | "estimated";
  createdAt: string;
  reversedAt: string;
  reverseReason: string;
  targets: ArtworkTargetSnapshot[];
}
export interface ArtworkExpenseRecord extends NamedRecord {
  artworkId: string;
  amount: number;
  notes: string;
  createdAt: string;
  allocations: ArtworkAllocationVersion[];
  voidedAt: string;
  voidReason: string;
}
export interface ArtworkExpenseInput {
  name: string;
  artworkId: string;
  amount: number;
  notes: string;
}
export interface ManagedArtworkAllocation extends ExactFraction {
  sourceId: string;
  version: number;
}
export interface ExpensePaymentInput {
  operationId?: string;
  costId: string;
  artworkSourceId: string;
  category: "print" | "other" | "artwork";
  payerId: string;
  recipient: string;
  amount: number;
  notes: string;
}
export interface ExpensePaymentRecord extends NamedRecord, ExpensePaymentInput {
  operationId: string;
  createdAt: string;
  reversedAt: string;
  reverseReason: string;
}
