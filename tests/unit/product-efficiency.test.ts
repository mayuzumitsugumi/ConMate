import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import { putProduct } from "../../src/domain/catalog/operations";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
import {
  barcodeMatches,
  validateProductMedia,
  validateThumbnailBudget,
} from "../../src/domain/catalog/product-media";
import {
  applyProductNotes,
  previewProductNotes,
} from "../../src/domain/catalog/bulk";
import { exportProject } from "../../src/infrastructure/excel/project";
import { inspectProject } from "../../src/infrastructure/excel/restore";
import { prepareHandoff } from "../../src/domain/activity/operations";
import {
  exportActivity,
  inspectActivity,
} from "../../src/infrastructure/excel/activity";
import { putEvent } from "../../src/domain/catalog/projects";
import {
  addLocation,
  addMovement,
} from "../../src/domain/inventory/operations";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
function fixture() {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "local",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  });
  const input = {
    name: "item",
    productType: "",
    specification: "",
    artwork: "",
    notes: "private",
    tagIds: [],
    customValues: {},
    barcode: "00123",
    thumbnail: png,
  };
  const p = putProduct(s, input);
  return { s, p, input };
}
it("round trips media through full backup and upgrades old snapshots without inventing media", async () => {
  const { s } = fixture();
  expect(await inspectProject(await exportProject(s))).toEqual(s);
  const old = structuredClone(s) as any;
  old.schemaVersion = 22;
  delete old.products[0].barcode;
  delete old.products[0].thumbnail;
  const migrated = validateRestoreSnapshot(old);
  expect(migrated.schemaVersion).toBe(23);
  expect(migrated.products[0]!.barcode).toBeUndefined();
  expect(old.schemaVersion).toBe(22);
});
it("preserves media on ordinary omitted-field updates and resolves exact duplicate/code collisions explicitly", () => {
  const { s, p, input } = fixture();
  const { barcode, thumbnail, ...plain } = input;
  putProduct(s, { ...plain, notes: "new" }, p.id);
  expect(p.thumbnail).toBe(thumbnail);
  const other = putProduct(s, { ...input, name: "other", barcode: p.code });
  expect(barcodeMatches(s.products, p.code)).toEqual([p, other]);
  expect(barcodeMatches(s.products, "00123")).toEqual([p]);
  expect(barcodeMatches(s.products, "123")).toEqual([]);
});
it("rejects remote, SVG, forged and oversized media and barcode controls", () => {
  for (const thumbnail of [
    "https://tracker.example/a.png",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64,QUJD",
    png + "A".repeat(24000),
  ])
    expect(() => validateProductMedia({ thumbnail })).toThrow();
  expect(() => validateProductMedia({ barcode: "a\nb" })).toThrow();
  expect(() =>
    validateThumbnailBudget([{ thumbnail: "a".repeat(4_000_001) }]),
  ).toThrow();
});
it("previews notes and rejects stale/tampered batches before modifying anything", () => {
  const { s, p } = fixture();
  const preview = previewProductNotes(s, [p.id], "updated");
  expect(p.notes).toBe("private");
  const before = structuredClone(s);
  expect(() => applyProductNotes(s, { ...preview, revision: 99 })).toThrow();
  expect(s).toEqual(before);
  applyProductNotes(s, preview);
  expect(p.notes).toBe("updated");
  expect(p.thumbnail).toBe(png);
  expect(s.movements).toEqual([]);
});
it("activity handoff includes only selected product media and survives file round trip", async () => {
  const { s, p, input } = fixture();
  putProduct(s, { ...input, name: "private-item", barcode: "PRIVATE-CODE" });
  const home = addLocation(s, "home");
  addMovement(s, {
    productId: p.id,
    kind: "receipt",
    quantity: 3,
    fromLocationId: "",
    toLocationId: home.id,
    reason: "receipt",
  });
  const event = putEvent(s, {
    name: "event",
    startDate: "2026-11-01",
    endDate: "2026-11-02",
    venue: "",
    notes: "",
    projectIds: [],
  });
  const { packet } = prepareHandoff(s, {
    name: "handoff",
    eventId: event.id,
    sourceLocationId: home.id,
    lines: [{ productId: p.id, quantity: 2 }],
    planIds: [],
    collectorIds: [],
  });
  expect(packet.snapshot.products).toHaveLength(1);
  expect(packet.snapshot.products[0]!.thumbnail).toBe(png);
  expect(JSON.stringify(packet)).not.toContain("PRIVATE-CODE");
  const checked = await inspectActivity(await exportActivity(packet));
  expect(checked.snapshot.products[0]!.barcode).toBe("00123");
});

it("rejects thumbnail headers declaring large decoded dimensions", () => {
  const bytes = atob(png.split(",")[1]!);
  const inflated = bytes.slice(0, 16) + "\x00\x00\x10\x00" + bytes.slice(20);
  expect(() =>
    validateProductMedia({
      thumbnail: "data:image/png;base64," + btoa(inflated),
    }),
  ).toThrow("尺寸");
});
