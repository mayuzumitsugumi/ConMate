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
  schemaVersion: 4;
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
  | "reversal";
export interface InventoryMovement extends NamedRecord {
  productId: string;
  kind: MovementKind;
  quantity: number;
  fromLocationId: string;
  toLocationId: string;
  reason: string;
  createdAt: string;
  reversesId: string;
}
export interface MovementInput {
  productId: string;
  kind: Exclude<MovementKind, "reversal">;
  quantity: number;
  fromLocationId: string;
  toLocationId: string;
  reason: string;
}
