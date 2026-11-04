import { internalSummary } from "../../domain/finance/internal-pricing";
import { batchCostReport } from "../../domain/finance/batch-costs";
import { batchBalances } from "../../domain/inventory/batches";
import { costSummary, advanceRepaid } from "../../domain/finance/operations";
import { balance } from "../../domain/inventory/operations";
import ExcelJS from "exceljs";
import type { CatalogSnapshot, CustomValue } from "../../domain/models/catalog";
export const PROJECT_FORMAT = "ConMate網站專案";
export const PROJECT_VERSION = "2.18.0";
const font = {
  name: "Microsoft JhengHei",
  size: 12,
  color: { argb: "FF253B34" },
};
const edge: Partial<ExcelJS.Border> = {
  style: "thin",
  color: { argb: "FFADB9AE" },
};
const edges: Partial<ExcelJS.Borders> = {
  top: edge,
  right: edge,
  bottom: edge,
  left: edge,
};
const typeNames = {
  text: "文字",
  number: "數字",
  single: "單選",
  multi: "多選",
  boolean: "是／否",
  date: "日期",
};
export async function buildProjectWorkbook(snapshot: CatalogSnapshot) {
  const book = new ExcelJS.Workbook();
  book.creator = "ConMate";
  book.created = new Date();
  function sheet(name: string, headers: string[]) {
    const ws = book.addWorksheet(name, {
      views: [{ state: "frozen", ySplit: 1, showGridLines: true }],
      properties: { defaultRowHeight: 32 },
    });
    ws.columns = headers.map((h) => ({
      header: h,
      width: h === "說明" ? 90 : 28,
      style: {
        font,
        numFmt: "@",
        alignment: { vertical: "top", wrapText: true },
        border: edges,
      },
    }));
    ws.getRow(1).height = 34;
    ws.getRow(1).eachCell((c) => {
      c.font = { ...font, bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF275C50" },
      };
    });
    return ws;
  }
  const info = sheet("00_專案說明", ["項目", "說明"]);
  info.addRows([
    ["工作區", snapshot.workspace.name],
    [
      "匯出時間（台灣時間）",
      new Intl.DateTimeFormat("zh-TW", {
        timeZone: "Asia/Taipei",
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(new Date()),
    ],
    [
      "使用方式",
      "先在ConMate網站建檔，按一下匯出一份專案檔。不必先填Excel，也不必自己輸入ID或new:。",
    ],
    [
      "內容",
      "只顯示有資料的商品與自訂設定；沒使用的成本、庫存、抽選等功能不加入空白表。",
    ],
    [
      "閱讀與編輯",
      "日常工作表供閱讀與核對。請回網站編輯資料後再匯出；這個網站建檔版不採用修改Excel後的資料。",
    ],
    [
      "完整資料",
      "隱藏的「_ConMate資料」保存本次網站建檔的完整紀錄、穩定ID、欄位選項及封存內容。隱藏不是加密，可在試算表取消隱藏。不要修改此表。",
    ],
    [
      "還原功能",
      "可在專案檔與備份頁檢查並還原本格式檔案。相同工作區需先預覽差異並明確確認取代；取代前會保存本機復原快照。請另行保留外部備份檔。",
    ],
    [
      "資料範圍",
      "本檔包含此工作區目前可建立的商品、創作者、企劃、場次、參場關聯、標記、自訂欄位及庫存異動；也包含攤位交易、販售方案與混合池、盤點、入庫批次分配、批次成本與代墊還款、柄圖分攤及分潤工作單。未開放的功能不會產生資料。",
    ],
    [
      "格式",
      `${PROJECT_FORMAT} ${PROJECT_VERSION}；來源修訂 ${snapshot.revision}`,
    ],
  ]);
  const fields = snapshot.fields.filter((f) => !f.archived);
  if (snapshot.products.length) {
    const ws = sheet("01_商品", [
      "商品名稱",
      "創作者",
      "企劃",
      "周邊種類",
      "規格",
      "柄圖",
      "標記",
      "備註",
      "狀態",
      ...fields.map((f) => `自訂｜${f.name}`),
      "商品擁有者",
    ]);
    const name = (records: { id: string; name: string }[], id: string) =>
      records.find((r) => r.id === id)?.name || "";
    for (const p of snapshot.products) {
      const values = fields.map((f) => {
        const value = p.customValues[f.id];
        if (value === null || value === undefined) return "";
        if (f.type === "single" || f.type === "multi")
          return (Array.isArray(value) ? value : [value])
            .map(
              (id) => f.options.find((o) => o.id === id)?.label || String(id),
            )
            .join("、");
        return typeof value === "boolean"
          ? value
            ? "TRUE"
            : "FALSE"
          : (value as string | number);
      });
      const row = ws.addRow([
        p.name,
        name(snapshot.parties, p.creatorId),
        name(snapshot.projects, p.projectId),
        name(snapshot.productTypes, p.typeId),
        p.specification,
        snapshot.artworks.find((a) => a.id === p.artworkId)?.name || p.artwork,
        p.tagIds.map((id) => name(snapshot.tags, id)).join("、"),
        p.notes,
        p.archived ? "已封存" : "使用中",
        ...values,
        name(snapshot.parties, p.ownerId),
      ]);
      fields.forEach((f, i) => {
        if (f.type === "number") row.getCell(10 + i).numFmt = "General";
      });
      row.height = Math.max(
        32,
        Math.min(180, Math.ceil(p.notes.length / 20) * 18),
      );
    }
    ws.autoFilter = {
      from: "A1",
      to: { row: ws.rowCount, column: ws.columnCount },
    };
  }
  if (snapshot.tags.length || snapshot.fields.length) {
    const ws = sheet("02_自訂設定", [
      "資料類型",
      "名稱",
      "欄位類型",
      "可選項目",
      "狀態",
    ]);
    snapshot.tags.forEach((t) =>
      ws.addRow(["商品標記", t.name, "", "", t.archived ? "已封存" : "使用中"]),
    );
    snapshot.fields.forEach((f) =>
      ws.addRow([
        "自訂欄位",
        f.name,
        typeNames[f.type],
        f.options
          .map((o) => o.label + (o.archived ? "（已封存）" : ""))
          .join("、"),
        f.archived ? "已封存" : "使用中",
      ]),
    );
  }
  if (snapshot.projects.length) {
    const ws = sheet("03_企劃", ["企劃名稱", "企劃說明", "參加場次", "狀態"]);
    for (const p of snapshot.projects)
      ws.addRow([
        p.name,
        p.description,
        snapshot.projectEvents
          .filter((r) => r.projectId === p.id)
          .map(
            (r) => snapshot.events.find((e) => e.id === r.eventId)?.name || "",
          )
          .join("、"),
        p.archived ? "已封存" : "使用中",
      ]);
  }
  if (snapshot.events.length) {
    const ws = sheet("04_場次", [
      "場次名稱",
      "開始日期",
      "結束日期",
      "地點",
      "參加企劃",
      "備註",
      "狀態",
    ]);
    for (const e of snapshot.events)
      ws.addRow([
        e.name,
        e.startDate,
        e.endDate,
        e.venue,
        snapshot.projectEvents
          .filter((r) => r.eventId === e.id)
          .map(
            (r) =>
              snapshot.projects.find((p) => p.id === r.projectId)?.name || "",
          )
          .join("、"),
        e.notes,
        e.archived ? "已封存" : "使用中",
      ]);
  }
  if (snapshot.movements.length || snapshot.locations.length) {
    const stock = sheet("05_庫存", ["商品", "庫位", "現存數量"]);
    const ledger = sheet("06_庫存異動", [
      "異動編號",
      "商品",
      "類型",
      "數量",
      "來源庫位",
      "目的庫位",
      "原因",
      "時間",
      "沖銷來源",
    ]);
    const label = (records: { id: string; name: string }[], id: string) =>
      records.find((r) => r.id === id)?.name || "";
    for (const p of snapshot.products)
      for (const l of snapshot.locations) {
        const value = balance(snapshot, p.id, l.id);
        if (
          value ||
          snapshot.movements.some(
            (m) =>
              m.productId === p.id &&
              (m.fromLocationId === l.id || m.toLocationId === l.id),
          )
        ) {
          const row = stock.addRow([p.name, l.name, value]);
          row.getCell(3).numFmt = "0";
        }
      }
    for (const m of snapshot.movements) {
      const row = ledger.addRow([
        m.code,
        label(snapshot.products, m.productId),
        m.name,
        m.quantity,
        label(snapshot.locations, m.fromLocationId),
        label(snapshot.locations, m.toLocationId),
        m.reason,
        m.createdAt,
        m.reversesId,
      ]);
      row.getCell(4).numFmt = "0";
    }
  }
  if (snapshot.onlineListings.length) {
    const ws = sheet("07_通販對照", [
      "商店／通路",
      "商品",
      "出貨庫位",
      "通販連結",
      "記錄的網店數量",
      "最後手動核對",
      "備註",
      "狀態",
    ]);
    for (const l of snapshot.onlineListings)
      ws.addRow([
        l.name,
        snapshot.products.find((p) => p.id === l.productId)?.name || "",
        snapshot.locations.find((p) => p.id === l.locationId)?.name || "",
        l.url,
        l.quantity,
        l.checkedAt,
        l.notes,
        l.archived ? "已封存" : "使用中",
      ]);
    ws.getColumn(5).numFmt = "0";
  }
  if (snapshot.movementTypes.length) {
    const ws = sheet("08_異動類型", ["類型名稱", "庫存變化", "狀態"]);
    for (const t of snapshot.movementTypes)
      ws.addRow([
        t.name,
        { increase: "增加庫存", decrease: "減少庫存", transfer: "移動庫存" }[
          t.effect
        ],
        t.archived ? "已封存" : "使用中",
      ]);
  }
  const label = (records: { id: string; name: string }[], id: string) =>
    records.find((r) => r.id === id)?.name || "";
  if (snapshot.sales.length) {
    const ws = sheet("09_銷售交易", [
      "交易編號",
      "成交時間",
      "場次",
      "出貨庫位",
      "收款者",
      "應收總額",
      "實際收款（換購為補收）",
      "找零／換購實退",
      "狀態",
      "取消時間",
      "取消原因",
      "備註",
      "換購折抵額",
      "換購編號",
    ]);
    const lines = sheet("10_銷售明細", [
      "交易編號",
      "成交商品名稱",
      "商品編號",
      "售法",
      "數量",
      "單價",
      "金額",
      "出庫編號",
      "成交方案名稱",
      "成交方案版本",
      "成交創作者",
      "成交商品擁有者",
      "成交柄圖",
      "成交柄圖作者",
    ]);
    for (const sale of snapshot.sales) {
      ws.addRow([
        sale.code,
        sale.createdAt,
        label(snapshot.events, sale.eventId),
        label(snapshot.locations, sale.locationId),
        label(snapshot.parties, sale.collectorId),
        sale.total,
        sale.cashReceived,
        sale.change,
        sale.cancelledAt ? "已全額退款並回庫" : "有效",
        sale.cancelledAt,
        sale.cancelReason,
        sale.notes,
        sale.exchangeCredit ?? "",
        snapshot.exchanges.find((e) => e.id === sale.exchangeId)?.code || "",
      ]);
      for (const l of sale.lines)
        lines.addRow([
          sale.code,
          l.productName,
          snapshot.products.find((p) => p.id === l.productId)?.code || "",
          l.mode === "draw" ? "抽選實際交付" : "指定購買",
          l.quantity,
          l.unitPrice,
          Number(BigInt(l.quantity) * BigInt(l.unitPrice)),
          snapshot.movements.find((m) => m.id === l.movementId)?.code || "",
          l.planName || "",
          l.planVersion ?? null,
          l.attribution?.creatorName || "",
          l.attribution?.ownerName || "",
          l.attribution?.artworkName || "",
          l.attribution?.authorNames.join("、") || "",
        ]);
    }
    for (const col of [6, 7, 8]) ws.getColumn(col).numFmt = "0";
    for (const col of [5, 6, 7]) lines.getColumn(col).numFmt = "0";
  }
  if (snapshot.costs.length) {
    const ws = sheet("11_批次成本", [
      "成本名稱",
      "商品",
      "製作數量",
      "預估印製費",
      "實際印製費",
      "柄圖整元分攤（核對）",
      "其他成本",
      "試算售價",
      "整元成本總額（核對）",
      "單件綜合成本",
      "全部售出預估毛利",
      "回本所需銷量",
      "印製費付款者註記",
      "成本負擔者註記",
      "狀態",
      "備註",
      "精確成本分子",
      "精確成本分母",
      "柄圖費來源",
      "柄圖分攤版本",
    ]);
    for (const c of snapshot.costs) {
      const result = costSummary(c);
      ws.addRow([
        c.name,
        label(snapshot.products, c.productId),
        c.quantity,
        c.estimatedPrint,
        c.actualPrint,
        c.artworkAllocated,
        c.otherCost,
        c.unitSalePrice,
        result?.integerTotal ?? null,
        result ? Number(result.unitCost) : null,
        result?.profit == null ? null : Number(result.profit),
        result?.breakEven == null ? null : Number(result.breakEven),
        label(snapshot.parties, c.paidById),
        label(snapshot.parties, c.burdenPartyId),
        c.archived ? "已封存" : "啟用",
        c.notes,
        result?.exactTotal.numerator ?? "",
        result?.exactTotal.denominator ?? "",
        c.artworkAllocation
          ? snapshot.artworkExpenses.find(
              (a) => a.id === c.artworkAllocation!.sourceId,
            )?.code || ""
          : "",
        c.artworkAllocation?.version ?? null,
      ]);
    }
    for (const col of [3, 4, 5, 6, 7, 8, 9, 12, 20])
      ws.getColumn(col).numFmt = "0";
    ws.getColumn(10).numFmt = "0.0000";
    ws.getColumn(11).numFmt = "0.0000";
  }
  if (snapshot.advances.length) {
    const ws = sheet("12_代墊本金", [
      "代墊編號",
      "名稱",
      "付款者",
      "約定負擔者",
      "實付可追收本金",
      "有效已還本金",
      "未還本金",
      "狀態",
      "作廢原因",
      "備註",
    ]);
    const payments = sheet("13_本金還款", [
      "代墊編號",
      "時間",
      "類型",
      "金額",
      "沖銷來源",
      "備註",
    ]);
    for (const a of snapshot.advances) {
      const paid = advanceRepaid(a);
      ws.addRow([
        a.code,
        a.name,
        label(snapshot.parties, a.payerId),
        label(snapshot.parties, a.debtorId),
        a.principal,
        paid,
        a.voidedAt ? 0 : a.principal - paid,
        a.voidedAt ? "已作廢" : "有效",
        a.voidReason,
        a.notes,
      ]);
      for (const r of a.repayments)
        payments.addRow([
          a.code,
          r.createdAt,
          r.reversesId ? "沖銷還款" : "本金償還",
          r.amount,
          r.reversesId,
          r.notes,
        ]);
    }
    for (const col of [5, 6, 7]) ws.getColumn(col).numFmt = "0";
    payments.getColumn(4).numFmt = "0";
  }
  if (snapshot.salePlans.length) {
    const ws = sheet("14_販售方案", [
      "方案名稱",
      "售法",
      "單價",
      "商品",
      "適用場次",
      "版本",
      "狀態",
    ]);
    for (const p of snapshot.salePlans)
      ws.addRow([
        p.name,
        p.mode === "draw" ? "抽選" : "指定",
        p.unitPrice,
        p.productIds
          .map((id) => snapshot.products.find((r) => r.id === id)?.name || "")
          .join("、"),
        p.eventIds.length
          ? p.eventIds
              .map((id) => snapshot.events.find((r) => r.id === id)?.name || "")
              .join("、")
          : "不限場次",
        p.version,
        p.archived ? "已封存" : "啟用",
      ]);
    ws.getColumn(3).numFmt = "0";
    ws.getColumn(6).numFmt = "0";
  }
  if (snapshot.stocktakes.length) {
    const ws = sheet("15_盤點單", [
      "盤點編號",
      "名稱",
      "庫位",
      "場次",
      "開始時間",
      "完成時間",
      "開始異動數",
      "完成前異動數",
      "完成時已過期",
      "備註",
    ]);
    const lines = sheet("16_盤點明細", [
      "盤點編號",
      "商品名稱",
      "帳面數量",
      "實點數量",
      "差額",
      "處理方式",
      "差異原因",
      "調整異動編號",
    ]);
    for (const t of snapshot.stocktakes) {
      ws.addRow([
        t.code,
        t.name,
        label(snapshot.locations, t.locationId),
        label(snapshot.events, t.eventId),
        t.createdAt,
        t.completedAt,
        t.cutoffMovementCount,
        t.completionMovementCount,
        t.staleAtCompletion ? "TRUE" : "FALSE",
        t.notes,
      ]);
      for (const l of t.lines)
        lines.addRow([
          t.code,
          l.productName,
          l.expected,
          l.actual,
          l.actual === null ? null : l.actual - l.expected,
          l.action === "adjust" ? "明確套用差異" : "保留待查",
          l.reason,
          snapshot.movements.find((m) => m.id === l.adjustmentMovementId)
            ?.code || "",
        ]);
    }
    for (const c of [7, 8]) ws.getColumn(c).numFmt = "0";
    for (const c of [3, 4, 5]) lines.getColumn(c).numFmt = "0";
  }
  if (snapshot.refunds.length) {
    const ws = sheet("17_退款退貨", [
      "退款編號",
      "原交易編號",
      "時間",
      "實際退款金額",
      "原因",
      "換購折抵額",
      "換購編號",
    ]);
    const detail = sheet("18_退款退貨明細", [
      "退款編號",
      "原明細ID",
      "成交商品",
      "退款／換購折抵額",
      "可售回庫數量",
      "損壞退回數量",
      "回庫庫位",
      "回庫異動編號",
    ]);
    for (const r of snapshot.refunds) {
      const sale = snapshot.sales.find((s) => s.id === r.saleId)!;
      ws.addRow([
        r.code,
        sale.code,
        r.createdAt,
        r.exchangeId ? 0 : r.total,
        r.reason,
        r.exchangeId ? r.total : "",
        snapshot.exchanges.find((e) => e.id === r.exchangeId)?.code || "",
      ]);
      for (const l of r.lines)
        detail.addRow([
          r.code,
          l.saleLineId,
          sale.lines.find((x) => x.id === l.saleLineId)?.productName || "",
          l.amount,
          l.restockQuantity,
          l.damagedQuantity,
          snapshot.locations.find((x) => x.id === l.returnLocationId)?.name ||
            "",
          snapshot.movements.find((x) => x.id === l.movementId)?.code || "",
        ]);
    }
    ws.getColumn(4).numFmt = "0";
    for (const col of [4, 5, 6]) detail.getColumn(col).numFmt = "0";
  }
  if (snapshot.artworkExpenses.length) {
    const ws = sheet("19_柄圖費來源", [
      "來源編號",
      "名稱",
      "柄圖",
      "來源總額",
      "建立時間",
      "狀態",
      "作廢原因",
      "備註",
    ]);
    const versions = sheet("20_柄圖分攤", [
      "來源編號",
      "版本",
      "方式",
      "權重基準",
      "成本編號",
      "製作數量快照",
      "印製總額快照",
      "自訂權重",
      "人工分攤額",
      "精確分攤分子",
      "精確分攤分母",
      "整元分攤",
      "原人工分攤額",
      "套用時間",
      "撤銷時間",
      "撤銷原因",
    ]);
    for (const a of snapshot.artworkExpenses) {
      ws.addRow([
        a.code,
        a.name,
        label(snapshot.artworks, a.artworkId),
        a.amount,
        a.createdAt,
        a.voidedAt ? "已作廢" : "有效",
        a.voidReason,
        a.notes,
      ]);
      for (const v of a.allocations)
        for (const t of v.targets)
          versions.addRow([
            a.code,
            v.version,
            {
              "unit-print": "單件印製成本比例",
              "total-print": "製作印製總額比例",
              equal: "成本品項平均",
              custom: "自訂權重",
              manual: "人工金額",
            }[v.method],
            v.basis === "actual" ? "實際" : "預估",
            snapshot.costs.find((c) => c.id === t.costId)?.code || "",
            t.quantity,
            t.printTotal,
            t.weight,
            t.manualAmount,
            t.exactAmount.numerator,
            t.exactAmount.denominator,
            t.integerAmount,
            t.previousAmount,
            v.createdAt,
            v.reversedAt,
            v.reverseReason,
          ]);
    }
    ws.getColumn(4).numFmt = "0";
    for (const col of [2, 6, 7, 9, 12, 13])
      versions.getColumn(col).numFmt = "0";
  }
  if (snapshot.expensePayments.length) {
    const ws = sheet("21_廠商付款", [
      "付款編號",
      "費用類別",
      "成本來源",
      "柄圖費來源",
      "實際付款人",
      "實際收款廠商",
      "金額",
      "付款登記時間",
      "沖銷時間",
      "沖銷原因",
      "備註",
    ]);
    for (const p of snapshot.expensePayments)
      ws.addRow([
        p.code,
        { print: "印製費", other: "其他費用", artwork: "柄圖費" }[p.category],
        label(snapshot.costs, p.costId),
        label(snapshot.artworkExpenses, p.artworkSourceId),
        label(snapshot.parties, p.payerId),
        p.recipient,
        p.amount,
        p.createdAt,
        p.reversedAt,
        p.reverseReason,
        p.notes,
      ]);
    ws.getColumn(7).numFmt = "0";
  }
  if (snapshot.settlements.length) {
    const groups = sheet("22_分配工作單", [
      "工作單編號",
      "名稱",
      "建立時間",
      "結束時間",
      "結束說明",
      "備註",
    ]);
    const trials = sheet("23_分潤試算", [
      "工作單",
      "試算ID",
      "時間",
      "狀態",
      "明細營收",
      "精確成本分子",
      "精確成本分母",
      "可分配精確分子",
      "可分配精確分母",
      "整元可分配額",
      "抽成基礎",
      "比例百分比",
      "固定費",
      "固定費順序",
      "負基礎政策",
      "未計算項",
      "提醒",
    ]);
    const shares = sheet("24_試算分配", [
      "工作單",
      "試算ID",
      "參與方",
      "整元試算分配",
    ]);
    const decisions = sheet("25_人工分配", [
      "工作單",
      "決定ID",
      "時間",
      "試算來源",
      "參與方",
      "累計目標分配",
      "總額",
      "與試算差額",
      "決定原因",
    ]);
    const payments = sheet("26_實際分款", [
      "工作單",
      "付款ID",
      "時間",
      "實際付款人",
      "實際收款人",
      "實付金額",
      "沖銷來源",
      "備註",
    ]);
    const holdings = sheet("27_期初持款", [
      "工作單",
      "登記時間",
      "參與方",
      "明確登記持款",
    ]);
    const statuses = sheet("28_工作單狀態", [
      "工作單",
      "狀態ID",
      "時間",
      "動作",
      "原因",
    ]);
    const cash = sheet("29_外部持款變動", [
      "工作單",
      "變動ID",
      "時間",
      "參與方",
      "實際增減持款",
      "原因",
      "沖銷來源",
    ]);
    for (const g of snapshot.settlements) {
      groups.addRow([
        g.code,
        g.name,
        g.createdAt,
        g.closedAt,
        g.closeReason,
        g.notes,
      ]);
      for (const t of g.trials) {
        const r = t.result;
        trials.addRow([
          g.code,
          t.id,
          t.createdAt,
          r.status === "complete" ? "試算完整" : "尚有未計算項",
          r.revenue,
          r.exactCosts?.numerator || "",
          r.exactCosts?.denominator || "",
          r.exactAvailable?.numerator || "",
          r.exactAvailable?.denominator || "",
          r.roundedBase,
          t.rules.base,
          t.rules.ratePercent,
          t.rules.fixedFee,
          t.rules.fixedOrder,
          t.rules.negativePolicy,
          r.unknownItems.join("、"),
          r.warnings.join("、"),
        ]);
        for (const a of r.allocations)
          shares.addRow([
            g.code,
            t.id,
            label(snapshot.parties, a.partyId),
            a.amount,
          ]);
      }
      for (const d of g.decisions) {
        if (!d.allocations.length)
          decisions.addRow([
            g.code,
            d.id,
            d.createdAt,
            d.trialId,
            "",
            0,
            d.total,
            d.variance,
            d.reason,
          ]);
        for (const a of d.allocations)
          decisions.addRow([
            g.code,
            d.id,
            d.createdAt,
            d.trialId,
            label(snapshot.parties, a.partyId),
            a.amount,
            d.total,
            d.variance,
            d.reason,
          ]);
      }
      for (const p of g.payments)
        payments.addRow([
          g.code,
          p.id,
          p.createdAt,
          label(snapshot.parties, p.fromPartyId),
          label(snapshot.parties, p.toPartyId),
          p.amount,
          p.reversesId,
          p.notes,
        ]);
      for (const h of g.openingHoldings || [])
        holdings.addRow([
          g.code,
          g.holdingsDeclaredAt,
          label(snapshot.parties, h.partyId),
          h.amount,
        ]);
      for (const a of g.cashAdjustments)
        cash.addRow([
          g.code,
          a.id,
          a.createdAt,
          label(snapshot.parties, a.partyId),
          a.amount,
          a.reason,
          a.reversesId,
        ]);
      for (const h of g.statusHistory)
        statuses.addRow([
          g.code,
          h.id,
          h.createdAt,
          h.kind === "close" ? "結束" : "重新開啟",
          h.reason,
        ]);
    }
    for (const [ws, cols] of [
      [trials, [5, 10, 13]],
      [shares, [4]],
      [decisions, [6, 7, 8]],
      [payments, [6]],
      [holdings, [4]],
      [cash, [5]],
    ] as const)
      for (const c of cols) ws.getColumn(c).numFmt = "0";
  }
  if (snapshot.movements.length) {
    const batches = sheet("30_入庫批次", [
      "商品",
      "入庫批次",
      "庫位",
      "數量",
      "批次來源識別",
    ]);
    const state = batchBalances(snapshot);
    for (const lot of state.lots.values())
      for (const loc of snapshot.locations) {
        const quantity = state.quantity(lot.id, loc.id);
        if (quantity)
          batches.addRow([
            snapshot.products.find((p) => p.id === lot.productId)?.name || "",
            lot.name,
            loc.name,
            quantity,
            lot.id,
          ]);
      }
    const allocations = sheet("31_批次異動", ["異動編號", "批次識別", "數量"]);
    for (const m of snapshot.movements)
      for (const a of m.batchAllocations)
        allocations.addRow([m.code, a.batchId, a.quantity]);
  }
  if (snapshot.parties.length) {
    const ws = sheet("32_創作者與參與方", ["名稱", "編號", "備註", "狀態"]);
    for (const p of snapshot.parties)
      ws.addRow([p.name, p.code, p.notes, p.archived ? "已封存" : "使用中"]);
  }
  if (snapshot.artworks.length) {
    const ws = sheet("33_柄圖主檔", [
      "柄圖名稱",
      "企劃",
      "作者",
      "備註",
      "狀態",
    ]);
    for (const a of snapshot.artworks)
      ws.addRow([
        a.name,
        snapshot.projects.find((p) => p.id === a.projectId)?.name || "",
        a.authorIds
          .map((id) => snapshot.parties.find((p) => p.id === id)?.name || "")
          .join("、"),
        a.notes,
        a.archived ? "已封存" : "使用中",
      ]);
  }
  if (snapshot.batchCostVersions.length) {
    const v = sheet("34_批次成本版本", [
      "版本編號",
      "入庫來源",
      "成本來源",
      "生效前異動數",
      "整批精確成本",
      "製作量",
      "原因",
    ]);
    for (const b of snapshot.batchCostVersions)
      v.addRow([
        b.code,
        b.batchId,
        b.costName,
        b.effectiveMovementCount,
        b.exactTotal
          ? `${b.exactTotal.numerator}/${b.exactTotal.denominator}`
          : "未知",
        b.quantity,
        b.notes,
      ]);
  }
  if (snapshot.sales.length) {
    const r = batchCostReport(snapshot),
      w = sheet("35_已售成本核對", [
        "交易",
        "商品",
        "原出貨已知成本",
        "退款後已知成本",
        "成本未知件數",
        "營收減未回庫成本差額",
      ]);
    for (const l of r.sales)
      w.addRow([
        l.saleCode,
        l.productName,
        l.knownCost,
        l.netKnownCost,
        l.unknownQuantity,
        l.margin ?? "未知",
      ]);
  }
  if (snapshot.internalAgreements.length) {
    const w = sheet("36_內部計價約定", [
      "約定編號",
      "名稱",
      "來源",
      "負擔者",
      "規劃數量",
      "來源成本",
      "內部負擔額",
      "約定每件回收",
      "規劃回收額",
      "回收與成本差額",
      "差額歸屬",
      "差額處理",
      "累計實收",
      "尚待回收",
      "前版",
      "狀態",
      "原因",
    ]);
    for (const a of snapshot.internalAgreements) {
      const r = internalSummary(snapshot, a);
      w.addRow([
        a.code,
        a.name,
        a.sourceName,
        snapshot.parties.find((p) => p.id === a.burdenPartyId)?.name ||
          "未指定",
        a.quantity,
        r.sourceTotal ?? "未知",
        a.internalTotal ?? "未知",
        a.agreedUnit ?? "未知",
        r.plannedTotal ?? "未知",
        r.difference ?? "未知",
        snapshot.parties.find((p) => p.id === a.differencePartyId)?.name ||
          "未指定",
        a.differenceTreatment,
        r.collected,
        r.remaining ?? "未知",
        a.previousId,
        a.voidedAt ? "作廢" : "保留",
        a.notes,
      ]);
    }
  }
  if (snapshot.internalReceipts.length) {
    const w = sheet("37_內部回收實收", [
      "編號",
      "約定",
      "付款者",
      "收款者",
      "金額",
      "時間",
      "沖銷來源",
      "原因",
    ]);
    for (const r of snapshot.internalReceipts)
      w.addRow([
        r.code,
        snapshot.internalAgreements.find((a) => a.id === r.agreementId)?.name ||
          r.agreementId,
        snapshot.parties.find((p) => p.id === r.payerId)?.name || "",
        snapshot.parties.find((p) => p.id === r.collectorId)?.name || "",
        r.amount,
        r.createdAt,
        r.reversesId,
        r.notes,
      ]);
  }
  if (snapshot.inventoryReservations.length) {
    const ws = sheet("38_專用庫存預留", [
      "預留編號",
      "方案",
      "商品",
      "庫位",
      "原預留數量",
      "建立時間",
      "釋放時間",
      "預留原因",
      "釋放原因",
    ]);
    for (const r of snapshot.inventoryReservations)
      ws.addRow([
        r.code,
        snapshot.salePlans.find((p) => p.id === r.planId)?.name || r.planId,
        snapshot.products.find((p) => p.id === r.productId)?.name ||
          r.productId,
        snapshot.locations.find((l) => l.id === r.locationId)?.name ||
          r.locationId,
        r.quantity,
        r.createdAt,
        r.releasedAt,
        r.reason,
        r.releaseReason,
      ]);
  }
  if (snapshot.physicalUnits.length) {
    const ws = sheet("39_特殊單件", [
      "單件編號",
      "實物標記",
      "商品",
      "原始批次",
      "登記庫位",
      "登記異動起點",
      "登記時間",
    ]);
    for (const u of snapshot.physicalUnits)
      ws.addRow([
        u.code,
        u.label,
        snapshot.products.find((p) => p.id === u.productId)?.name || "",
        u.batchId,
        snapshot.locations.find((l) => l.id === u.registeredLocationId)?.name ||
          "",
        u.registeredMovementCount,
        u.createdAt,
      ]);
  }
  if (snapshot.exchanges.length) {
    const ws = sheet("40_換購差額", [
      "換購編號",
      "原交易",
      "退款記錄",
      "新交易",
      "原品項折抵額",
      "新交易金額",
      "應補收／退回差額",
      "已確認實收／實退差額",
      "款項經手人",
      "時間",
      "原因",
    ]);
    for (const e of snapshot.exchanges)
      ws.addRow([
        e.code,
        snapshot.sales.find((s) => s.id === e.originalSaleId)?.code ||
          e.originalSaleId,
        snapshot.refunds.find((r) => r.id === e.refundId)?.code || e.refundId,
        snapshot.sales.find((s) => s.id === e.replacementSaleId)?.code ||
          e.replacementSaleId,
        e.refundTotal,
        e.replacementTotal,
        e.difference,
        e.actualDifference,
        snapshot.parties.find((p) => p.id === e.collectorId)?.name || "未指定",
        e.createdAt,
        e.reason,
      ]);
  }
  const raw = sheet("_ConMate資料", ["項目", "資料"]);
  raw.state = "hidden";
  raw.addRows([
    ["format", PROJECT_FORMAT],
    ["version", PROJECT_VERSION],
    ["workspaceId", snapshot.workspaceId],
    ["revision", String(snapshot.revision)],
  ]);
  const encoded = JSON.stringify(snapshot);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(encoded),
  );
  raw.addRow([
    "payloadSha256",
    [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
  ]);
  // ASCII transport avoids surrogate/UTF-8 boundary corruption in spreadsheet XML readers.
  const bytes = new TextEncoder().encode(encoded);
  raw.addRows([
    ["payloadEncoding", "utf8-base64"],
    ["payloadByteLength", String(bytes.length)],
  ]);
  for (let i = 0; i < bytes.length; i += 12000) {
    const chunk = btoa(String.fromCharCode(...bytes.subarray(i, i + 12000)));
    raw.addRow([`payload-${String(i / 12000).padStart(6, "0")}`, chunk]);
  }
  for (const ws of book.worksheets)
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        cell.border = edges;
        if (row.number !== 1) cell.font = font;
      }),
    );
  return book;
}
export async function exportProject(
  snapshot: CatalogSnapshot,
): Promise<ArrayBuffer> {
  const buffer = await (
    await buildProjectWorkbook(snapshot)
  ).xlsx.writeBuffer();
  return Uint8Array.from(buffer as unknown as Uint8Array).buffer;
}
