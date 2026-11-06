import type {
  NamedRecord,
  SaleLineInput,
  RefundLineInput,
} from "../models/catalog";
export interface PreorderLine {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}
export interface PreorderInput {
  operationId: string;
  name: string;
  customerReference: string;
  notes: string;
  lines: { productId: string; quantity: number; unitPrice: number }[];
}
export interface PreorderPaymentInput {
  confirmedOutstanding?: boolean;
  operationId: string;
  amount: number;
  partyId: string;
  occurredAt: string;
  reason: string;
}
export interface PreorderFulfillmentInput {
  allowUnpaidDelivery?: boolean;
  operationId: string;
  locationId: string;
  lines: { orderLineId: string; quantity: number; unitIds?: string[] }[];
  reason: string;
}
export interface PreorderCancelInput {
  operationId: string;
  lines: { orderLineId: string; quantity: number }[];
  reason: string;
}
export interface PreorderReturnInput {
  operationId: string;
  saleId: string;
  lines: RefundLineInput[];
  reason: string;
}
export interface Preorder extends NamedRecord {
  createOperationId: string;
  customerReference: string;
  notes: string;
  createdAt: string;
  closedAt: string;
  lines: PreorderLine[];
  payments: {
    id: string;
    kind: "receipt" | "refund" | "receipt-reversal";
    confirmedOutstanding?: boolean;
    amount: number;
    partyId: string;
    occurredAt: string;
    createdAt: string;
    reason: string;
    reversesId: string;
  }[];
  fulfillments: {
    id: string;
    saleId: string;
    allowUnpaidDelivery?: boolean;
    createdAt: string;
    lines: { orderLineId: string; saleLineId: string; quantity: number }[];
  }[];
  cancellations: {
    id: string;
    createdAt: string;
    lines: { orderLineId: string; quantity: number }[];
    reason: string;
  }[];
  returnIds: string[];
  operations: {
    id: string;
    kind: string;
    request: unknown;
    resultId: string;
  }[];
  statusHistory: { closed: boolean; at: string; reason: string }[];
}
