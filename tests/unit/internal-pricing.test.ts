import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
import { ConMateDatabase } from "../../src/infrastructure/storage/workspaces";
import Dexie from "dexie";
import { putProduct } from "../../src/domain/catalog/operations";
import { putParty } from "../../src/domain/catalog/masterdata";
import { putCost } from "../../src/domain/finance/operations";
import {
  createInternalAgreement,
  internalSummary,
  recordInternalReceipt,
  reverseInternalReceipt,
  voidInternalAgreement,
} from "../../src/domain/finance/internal-pricing";
import { validateRestoreSnapshot } from "../../src/domain/validation/restore";
import { exportProject } from "../../src/infrastructure/excel/project";
import { inspectProject } from "../../src/infrastructure/excel/restore";
function setup(amount: number | null = 1368) {
  const s = emptyCatalog({
    id: crypto.randomUUID(),
    name: "內部計價",
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  });
  const p = putProduct(s, {
    name: "立牌",
    productType: "立牌",
    specification: "",
    artwork: "",
    notes: "",
    tagIds: [],
    customValues: {},
  });
  const a = putParty(s, { name: "成員", notes: "" }),
    b = putParty(s, { name: "總召", notes: "" });
  putCost(s, {
    name: "實際成本",
    productId: p.id,
    quantity: 10,
    estimatedPrint: 1710,
    actualPrint: amount,
    artworkAllocated: 0,
    otherCost: 0,
    unitSalePrice: null,
    paidById: b.id,
    burdenPartyId: a.id,
    notes: "",
  });
  return {
    s,
    a,
    b,
    input: {
      name: "回收約定",
      sourceType: "cost" as const,
      sourceId: s.costs[0]!.id,
      burdenPartyId: a.id,
      quantity: 10,
      internalTotal: amount,
      agreedUnit: "136.8",
      differencePartyId: "",
      differenceTreatment: "",
      notes: "依實付金額負擔",
    },
  };
}
it("uses actual1368 instead of estimate1710 and never creates342 funds or debt", () => {
  const x = setup(),
    a = createInternalAgreement(x.s, x.input);
  expect(internalSummary(x.s, a)).toMatchObject({
    sourceTotal: "1368.0000",
    plannedTotal: "1368.0000",
    difference: "0.0000",
    burdenDifference: "0.0000",
    collected: 0,
  });
  expect(x.s.advances).toHaveLength(0);
  expect(x.s.expensePayments).toHaveLength(0);
  expect(x.s.sales).toHaveLength(0);
});
it("keeps 4000cost and4020recovery20difference explicitly unresolved", () => {
  const x = setup(4000),
    a = createInternalAgreement(x.s, {
      ...x.input,
      quantity: 30,
      internalTotal: 4000,
      agreedUnit: "134",
    });
  expect(internalSummary(x.s, a)).toMatchObject({
    plannedTotal: "4020.0000",
    difference: "20.0000",
    differenceResolved: false,
  });
});
it("records explicit difference treatment without paying or recognizing revenue", () => {
  const x = setup(4000),
    a = createInternalAgreement(x.s, {
      ...x.input,
      quantity: 30,
      agreedUnit: "134",
      differencePartyId: x.b.id,
      differenceTreatment: "另留團務依人工決定",
    });
  expect(internalSummary(x.s, a).differenceResolved).toBe(true);
  expect(x.s.internalReceipts).toHaveLength(0);
});
it("preserves unknown separately from explicitzero", () => {
  const x = setup(null),
    a = createInternalAgreement(x.s, {
      ...x.input,
      internalTotal: null,
      agreedUnit: null,
    });
  expect(internalSummary(x.s, a)).toMatchObject({
    sourceTotal: null,
    plannedTotal: null,
    difference: null,
    remaining: null,
  });
  const z = createInternalAgreement(x.s, {
    ...x.input,
    internalTotal: 0,
    agreedUnit: "0",
  });
  expect(internalSummary(x.s, z).plannedTotal).toBe("0.0000");
});
it("does not silently modify snapshots after cost edit", () => {
  const x = setup(),
    a = createInternalAgreement(x.s, x.input);
  x.s.costs[0]!.actualPrint = 999;
  expect(internalSummary(x.s, a).sourceTotal).toBe("1368.0000");
  expect(validateRestoreSnapshot(x.s)).toEqual(x.s);
});
it("retains ancestor receipts cumulatively when revising plan", () => {
  const x = setup(),
    a = createInternalAgreement(x.s, x.input);
  recordInternalReceipt(x.s, {
    agreementId: a.id,
    payerId: x.a.id,
    collectorId: x.b.id,
    amount: 1000,
    notes: "實際已收",
  });
  const b = createInternalAgreement(
    x.s,
    { ...x.input, agreedUnit: "140", notes: "新規則" },
    a.id,
  );
  expect(internalSummary(x.s, b)).toMatchObject({
    collected: 1000,
    remaining: "400.0000",
  });
  expect(() =>
    recordInternalReceipt(x.s, {
      agreementId: a.id,
      payerId: x.a.id,
      collectorId: x.b.id,
      amount: 1,
      notes: "不可舊版",
    }),
  ).toThrow();
  expect(validateRestoreSnapshot(x.s)).toEqual(x.s);
});
it("reverses actual receipts once and does not duplicate principal", () => {
  const x = setup(),
    a = createInternalAgreement(x.s, x.input),
    r = recordInternalReceipt(x.s, {
      agreementId: a.id,
      payerId: x.a.id,
      collectorId: x.b.id,
      amount: 500,
      notes: "實收",
    });
  reverseInternalReceipt(x.s, r.id, "輸入有誤");
  expect(internalSummary(x.s, a).collected).toBe(0);
  expect(() => reverseInternalReceipt(x.s, r.id, "再按一次")).toThrow();
  voidInternalAgreement(x.s, a.id, "不用了");
  expect(validateRestoreSnapshot(x.s)).toEqual(x.s);
  expect(x.s.advances).toHaveLength(0);
});
it("shows overcollection negative difference without autoassuming profit", () => {
  const x = setup(),
    a = createInternalAgreement(x.s, x.input);
  recordInternalReceipt(x.s, {
    agreementId: a.id,
    payerId: x.a.id,
    collectorId: x.b.id,
    amount: 1400,
    notes: "實收待查",
  });
  expect(internalSummary(x.s, a).remaining).toBe("-32.0000");
  expect(() => voidInternalAgreement(x.s, a.id, "有款不能作廢")).toThrow();
});
it("rejects foreign parties badprecision unsafe amounts and invalidversions", () => {
  const x = setup();
  expect(() =>
    createInternalAgreement(x.s, { ...x.input, burdenPartyId: "foreign" }),
  ).toThrow();
  expect(() =>
    createInternalAgreement(x.s, { ...x.input, agreedUnit: "1.12345" }),
  ).toThrow();
  expect(() =>
    createInternalAgreement(x.s, {
      ...x.input,
      agreedUnit: "9007199254740991",
    }),
  ).toThrow();
  expect(() => createInternalAgreement(x.s, x.input, "missing")).toThrow();
});
it("retains fourdecimal exact arithmetic", () => {
  const x = setup(1),
    a = createInternalAgreement(x.s, {
      ...x.input,
      quantity: 3,
      agreedUnit: "0.3333",
    });
  expect(internalSummary(x.s, a)).toMatchObject({
    plannedTotal: "0.9999",
    difference: "-0.0001",
  });
});
it("rejects forged reversal and version chains on restore", () => {
  const x = setup(),
    a = createInternalAgreement(x.s, x.input),
    r = recordInternalReceipt(x.s, {
      agreementId: a.id,
      payerId: x.a.id,
      collectorId: x.b.id,
      amount: 500,
      notes: "實收",
    });
  reverseInternalReceipt(x.s, r.id, "錯誤");
  x.s.internalReceipts[1]!.amount = 400;
  expect(() => validateRestoreSnapshot(x.s)).toThrow();
  x.s.internalReceipts[1]!.amount = 500;
  a.previousId = a.id;
  expect(() => validateRestoreSnapshot(x.s)).toThrow();
});
it("upgrades schema15 with no invented agreements and persists full workbook", async () => {
  const x = setup(),
    old: any = structuredClone(x.s);
  old.schemaVersion = 15;
  delete old.internalAgreements;
  delete old.internalReceipts;
  expect(validateRestoreSnapshot(old).internalAgreements).toEqual([]);
  const a = createInternalAgreement(x.s, x.input);
  recordInternalReceipt(x.s, {
    agreementId: a.id,
    payerId: x.a.id,
    collectorId: x.b.id,
    amount: 100,
    notes: "實收",
  });
  expect(await inspectProject(await exportProject(x.s))).toEqual(x.s);
});
it("migrates Dexie16 to17 preserving IDs and money", async () => {
  const x = setup(),
    name = "internal-" + crypto.randomUUID(),
    old = new Dexie(name);
  old
    .version(16)
    .stores({
      workspaces: "id, createdAt",
      catalogs: "workspaceId",
      recoverySnapshots: "id, workspaceId, createdAt",
      backupStatus: "workspaceId",
    });
  const data: any = structuredClone(x.s);
  data.schemaVersion = 15;
  delete data.internalAgreements;
  delete data.internalReceipts;
  await old.table("workspaces").add(x.s.workspace);
  await old.table("catalogs").add(data);
  old.close();
  const db = new ConMateDatabase(name);
  try {
    const next = await db.catalogs.get(x.s.workspaceId);
    expect(next?.schemaVersion).toBe(23);
    expect(next?.costs).toEqual(x.s.costs);
    expect(next?.internalAgreements).toEqual([]);
  } finally {
    await db.delete();
  }
});

it('uses a real artwork expense snapshot and keeps supplier payment separate', async()=>{
 const {putArtwork}=await import('../../src/domain/catalog/masterdata');
 const {putArtworkExpense}=await import('../../src/domain/finance/artwork');
 const x=setup(),art=putArtwork(x.s,{name:'塔塔柄圖',projectId:'',authorIds:[],notes:''});
 const expense=putArtworkExpense(x.s,{name:'塔塔柄圖費',artworkId:art.id,amount:4000,notes:'已確認成本'});
 const a=createInternalAgreement(x.s,{...x.input,sourceType:'artwork',sourceId:expense.id,quantity:30,internalTotal:4000,agreedUnit:'134'});
 expect(internalSummary(x.s,a)).toMatchObject({sourceTotal:'4000.0000',plannedTotal:'4020.0000',difference:'20.0000'});
 expect(x.s.expensePayments).toHaveLength(0);expect(validateRestoreSnapshot(x.s)).toEqual(x.s);
});
