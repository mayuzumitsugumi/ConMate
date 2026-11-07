import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import Dexie from "dexie";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import { ConMateDatabase } from "../../src/infrastructure/storage/workspaces";
import { putProduct } from "../../src/domain/catalog/operations";
import {
  putParty,
  putArtwork,
  togglePartyArchive,
  toggleArtworkArchive,
} from "../../src/domain/catalog/masterdata";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
import { exportProject } from "../../src/infrastructure/excel/project";
import { inspectProject } from "../../src/infrastructure/excel/restore";
const input = {
  name: "徽章",
  productType: "徽章",
  specification: "",
  artwork: "",
  notes: "",
  tagIds: [],
  customValues: {},
};
function setup() {
  return emptyCatalog({
    id: crypto.randomUUID(),
    name: "測試",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  });
}
it("separates creator, owner and multiple explicit artwork authors; stable IDs survive rename", () => {
  const s = setup(),
    creator = putParty(s, { name: "創作者", notes: "" }),
    owner = putParty(s, { name: "擁有者", notes: "" }),
    artist = putParty(s, { name: "繪師", notes: "" });
  const art = putArtwork(s, {
    name: "夜空",
    projectId: "",
    authorIds: [artist.id],
    notes: "",
  });
  const p = putProduct(s, {
    ...input,
    creatorId: creator.id,
    ownerId: owner.id,
    artworkId: art.id,
  });
  expect(p.creatorId).not.toBe(p.ownerId);
  expect(art.authorIds).toEqual([artist.id]);
  putParty(s, { name: "新筆名", notes: "備註" }, artist.id);
  putArtwork(
    s,
    {
      name: "夜空改名",
      projectId: "",
      authorIds: [artist.id, creator.id],
      notes: "",
    },
    art.id,
  );
  expect(p.artworkId).toBe(art.id);
  expect(s.artworks[0].authorIds).toEqual([artist.id, creator.id]);
  expect(validateRestoreSnapshot(s)).toEqual(s);
});
it("never infers ownership or artwork authors from creator", () => {
  const s = setup();
  const p = putProduct(s, { ...input, creatorName: "甲", artwork: "圖" });
  expect(p.ownerId).toBe("");
  expect(s.artworks[0].authorIds).toEqual([]);
});
it("archive retains links but refuses new product author/owner/art links and new artwork authors", () => {
  const s = setup(),
    party = putParty(s, { name: "甲", notes: "" }),
    art = putArtwork(s, {
      name: "圖",
      projectId: "",
      authorIds: [party.id],
      notes: "",
    });
  const p = putProduct(s, {
    ...input,
    creatorId: party.id,
    ownerId: party.id,
    artworkId: art.id,
  });
  togglePartyArchive(s, party.id);
  toggleArtworkArchive(s, art.id);
  expect(() => putProduct(s, { ...input, creatorId: party.id })).toThrow(
    "封存",
  );
  expect(() => putProduct(s, { ...input, ownerId: party.id })).toThrow(
    "擁有者",
  );
  expect(() => putProduct(s, { ...input, artworkId: art.id })).toThrow("柄圖");
  expect(() =>
    putArtwork(s, {
      name: "圖二",
      projectId: "",
      authorIds: [party.id],
      notes: "",
    }),
  ).toThrow("作者");
  expect(() =>
    putProduct(
      s,
      { ...input, creatorId: party.id, ownerId: party.id, artworkId: art.id },
      p.id,
    ),
  ).not.toThrow();
  togglePartyArchive(s, party.id);
  toggleArtworkArchive(s, art.id);
  expect(p.artworkId).toBe(art.id);
});
it("rejects foreign references, duplicate authors, names and unsafe notes", () => {
  const s = setup(),
    p = putParty(s, { name: "甲", notes: "" });
  expect(() => putParty(s, { name: "甲", notes: "" })).toThrow();
  expect(() => putParty(s, { name: "乙", notes: "\u0001" })).toThrow();
  expect(() =>
    putArtwork(s, {
      name: "圖",
      projectId: "",
      authorIds: [p.id, p.id],
      notes: "",
    }),
  ).toThrow();
  expect(() => putProduct(s, { ...input, ownerId: "foreign" })).toThrow();
  const a = putArtwork(s, {
    name: "圖",
    projectId: "",
    authorIds: [],
    notes: "",
  });
  a.authorIds = ["foreign"];
  expect(() => validateRestoreSnapshot(s)).toThrow("關聯");
});
it("upgrades schema13 backup without inventing owner/authors and leaves source unchanged", () => {
  const s = setup();
  putProduct(s, { ...input, creatorName: "甲", artwork: "圖" });
  const old: any = structuredClone(s);
  old.schemaVersion = 13;
  delete old.products[0].ownerId;
  delete old.parties[0].notes;
  delete old.parties[0].archived;
  delete old.artworks[0].authorIds;
  delete old.artworks[0].notes;
  delete old.artworks[0].archived;
  const got = validateRestoreSnapshot(old);
  expect(got.schemaVersion).toBe(23);
  expect(got.products[0].ownerId).toBe("");
  expect(got.artworks[0].authorIds).toEqual([]);
  expect(got.products[0].creatorId).toBe(s.products[0].creatorId);
  expect(old.products[0].ownerId).toBeUndefined();
});
it("installed schema13 migration preserves IDs/revision and creates no economic events", async () => {
  const s = setup();
  putProduct(s, { ...input, creatorName: "甲", artwork: "圖" });
  const old: any = structuredClone(s);
  old.schemaVersion = 13;
  delete old.products[0].ownerId;
  const name = "master-" + crypto.randomUUID();
  const db = new Dexie(name);
  db.version(14).stores({
    workspaces: "id, createdAt",
    catalogs: "workspaceId",
    recoverySnapshots: "id, workspaceId, createdAt",
    backupStatus: "workspaceId",
  });
  await db.table("workspaces").put(s.workspace);
  await db.table("catalogs").put(old);
  db.close();
  const next = new ConMateDatabase(name);
  try {
    const got = await next.catalogs.get(s.workspaceId);
    expect(got!.products[0].id).toBe(s.products[0].id);
    expect(got!.revision).toBe(s.revision);
    expect(got!.sales).toEqual([]);
    expect(got!.products[0].ownerId).toBe("");
  } finally {
    await next.delete();
  }
});
it("roundtrips master archive, authors and ownership in complete project", async () => {
  const s = setup(),
    p = putParty(s, { name: "甲", notes: "備註" }),
    a = putArtwork(s, {
      name: "圖",
      projectId: "",
      authorIds: [p.id],
      notes: "作者明確",
    });
  putProduct(s, { ...input, ownerId: p.id, artworkId: a.id });
  toggleArtworkArchive(s, a.id);
  togglePartyArchive(s, p.id);
  expect(await inspectProject(await exportProject(s))).toEqual(s);
});

it("new sales keep explicit attribution snapshot when owner and artwork authors later change", async () => {
  const { addLocation, addMovement } =
    await import("../../src/domain/inventory/operations");
  const { completeSale } = await import("../../src/domain/sales/operations");
  const s = setup(),
    first = putParty(s, { name: "原主人", notes: "" }),
    second = putParty(s, { name: "新主人", notes: "" }),
    artist = putParty(s, { name: "原繪師", notes: "" });
  const a = putArtwork(s, {
      name: "原圖",
      projectId: "",
      authorIds: [artist.id],
      notes: "",
    }),
    p = putProduct(s, {
      ...input,
      creatorId: first.id,
      ownerId: first.id,
      artworkId: a.id,
    }),
    loc = addLocation(s, "家中");
  addMovement(s, {
    productId: p.id,
    kind: "receipt",
    quantity: 2,
    fromLocationId: "",
    toLocationId: loc.id,
    reason: "製作",
  });
  const sale = completeSale(s, {
    operationId: crypto.randomUUID(),
    locationId: loc.id,
    eventId: "",
    collectorId: first.id,
    cashReceived: 100,
    notes: "",
    lines: [{ productId: p.id, mode: "direct", quantity: 1, unitPrice: 100 }],
  });
  const before = structuredClone(sale.lines[0].attribution);
  putParty(s, { name: "繪師新名", notes: "" }, artist.id);
  putArtwork(
    s,
    { name: "改圖名", projectId: "", authorIds: [], notes: "" },
    a.id,
  );
  putProduct(
    s,
    { ...input, creatorId: first.id, ownerId: second.id, artworkId: a.id },
    p.id,
  );
  expect(sale.lines[0].attribution).toEqual(before);
  expect(before!.ownerName).toBe("原主人");
  expect(before!.authorNames).toEqual(["原繪師"]);
  expect(validateRestoreSnapshot(s).sales[0].lines[0].attribution).toEqual(
    before,
  );
});
