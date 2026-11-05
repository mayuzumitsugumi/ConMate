import type { NamedRecord } from "../models/catalog";
export interface Consignment extends NamedRecord {
  storePartyId: string;
  locationId: string;
  notes: string;
  createdAt: string;
  closedAt: string;
  operations: {
    id: string;
    kind: "delivery" | "return" | "remittance";
    request: unknown;
    resultId: string;
  }[];
  deliveryIds: string[];
  returnIds: string[];
  saleIds: string[];
  refundIds: string[];
  statements: {
    id: string;
    fee: number | null;
    adjustment: number | null;
    reason: string;
    createdAt: string;
  }[];
  remittances: {
    id: string;
    amount: number;
    receivedAt: string;
    reason: string;
    reversesId: string;
    createdAt: string;
  }[];
  statusHistory: { at: string; closed: boolean; reason: string }[];
}
