import ExcelJS from "exceljs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const contract = JSON.parse(
  await readFile(new URL("docs/contracts/workbook.json", root), "utf8"),
);
const fixture = JSON.parse(
  await readFile(
    new URL("tests/fixtures/contracts/workspace.json", root),
    "utf8",
  ),
);
const directory = new URL("public/templates/", root);
await mkdir(directory, { recursive: true });
const fills = {
  system: "FFE7E9E7",
  required: "FFEAF3FC",
  optional: "FFFFF5D9",
};
const numeric = new Set([
  "positiveInteger",
  "quantity",
  "money",
  "signedMoney",
  "unitMoney",
  "percent",
]);
const instructions = [
  [
    "檔案用途",
    "ConMate 工作區建檔模板；這不是既有資料的備份。第一版網站提供模板下載，本機建立工作區；完整匯入與財務計算仍在開發中。請保留外部原檔。",
  ],
  [
    "適用版本",
    "ConMate Excel 格式 1.0.0；網站 v0.1。空白與虛構範例模板欄位相同。",
  ],
  [
    "開始填寫",
    "先填03參與方、04企劃，再填商品、柄圖、製作批次及場次。不是每張工作表都要填；沒有資料的表保留表頭即可。",
  ],
  [
    "顏色規則",
    "灰色：系統欄不可改。淡藍：必填輸入。淡黃：選填或條件必填。請同時閱讀表頭註解，不只依靠顏色。",
  ],
  [
    "資料區",
    "第1列是欄名，第2列起填資料；不要刪表、改欄名、合併儲存格。所有工作表都顯示。可排序資料，但應整列一起移動。",
  ],
  [
    "正式 ID",
    "新資料的正式ID、顯示編號、修訂號與建立／更新時間留白。ConMate匯入後產生。既有資料不可改ID。",
  ],
  [
    "新增代號",
    "要被其他資料引用時填入唯一暫時代號，例如 星狐徽章。它不是正式ID；同一表內不可重複。",
  ],
  [
    "跨表參照",
    "引用新資料填 new:星狐徽章；引用既有資料填 code:SKU-000001。不得用列號或儲存格位置。排序後關聯才不會改變。",
  ],
  [
    "純文字",
    "名稱、代號、參照、號碼均用文字，例如007保留前導零。文字看起來像公式仍須是真正文字，不輸入實際公式。",
  ],
  [
    "純數值",
    "金額與數量用數值，不能填NT$、元、個或說明文字。正式款項為整數元；單價／回收額最多四位小數。",
  ],
  ["比例", "填0至100數值，20代表20%；不要用百分比格式輸入0.2來表示20%。"],
  [
    "日期與時間",
    "日期用純文字YYYY-MM-DD；時間用含時區文字，例如2026-11-02T14:30:00+08:00。",
  ],
  ["布林值", "用純文字TRUE或FALSE，不填0、1或試算表原生布林。"],
  [
    "空白與零",
    "空白表示未提供，零表示確定為0；盤點空白不是實點0。必要規則未知時不自行補0。",
  ],
  [
    "禁止公式",
    "所有成本、庫存、分潤由ConMate計算。任何儲存格的實際公式都不允許；使用複製→貼上為值。下拉選單的範圍參照不屬於計算公式。",
  ],
  [
    "外部編輯",
    "Excel與LibreOffice可編輯。另存xlsx，不能只改副檔名。下拉與格式只輔助，不取代程式驗證。",
  ],
  [
    "匯入流程（待開放）",
    "選檔→獨立檢查→查看錯誤及差異→確認→正式匯入。驗證前不覆蓋目前工作區。此版沒有可用匯入器，勿把模板當成已匯入。",
  ],
  [
    "匯出流程（待開放）",
    "由ConMate匯出帶正式ID及重算結果的完整工作區，後續請編輯更新後檔案。模板下載不等於備份現有工作區。",
  ],
  [
    "財務與結案",
    "系統提供試算與紀錄；如何分款、追收與結案由使用者決定。成本回收、本金償還及抽成不可混為利潤。",
  ],
  [
    "備份提醒",
    "瀏覽器本機儲存可能因清除網站資料、換裝置或裝置故障遺失。請保存外部原檔，未提供完整匯出前勿輸入唯一重要資料。",
  ],
  [
    "常見錯誤：找不到參照",
    "檢查new:後的代號是否與目標表完全一致，不要填名稱猜配。",
  ],
  [
    "常見錯誤：重複ID",
    "複製成新增資料時清空系統欄，填新的新增代號。不要直接複製同ID多列。",
  ],
  [
    "常見錯誤：數值格式",
    "刪除數字中的貨幣符號／單位，轉成真正數值。日期則按規定以文字填寫。",
  ],
  [
    "虛構範例",
    "範例只有虛構建檔資料，沒有已成交交易或已計算分潤；不可視為真實庫存。實際入庫與銷售操作未在範例中執行。",
  ],
  [
    "後續功能",
    "號碼池、人工分配、盤點等欄位先固定，未完成的網站分頁不能實際執行。系統紀錄表請留白。",
  ],
];

export async function generateTemplate(kind) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ConMate";
  workbook.created = new Date("2026-11-02T00:00:00Z");
  workbook.modified = workbook.created;
  workbook.calcProperties.fullCalcOnLoad = false;
  const optionRanges = {};
  const dictionary = [];
  for (const [key, labels] of Object.entries(contract.options)) {
    const first = dictionary.length + 2;
    for (const label of labels)
      dictionary.push([key, label, label, contract.formatVersion]);
    optionRanges[key] = `opt_${key}`;
    workbook.definedNames.add(
      `'99_選項字典'!$C$${first}:$C$${dictionary.length + 1}`,
      optionRanges[key],
    );
  }
  for (const spec of contract.sheets) {
    const sheet = workbook.addWorksheet(spec.name, {
      state: "visible",
      views: [{ state: "frozen", ySplit: 1, xSplit: spec.entity ? 2 : 0 }],
    });
    sheet.columns = spec.columns.map((c) => ({
      header: c.label,
      key: c.key,
      width:
        c.key === "description"
          ? 95
          : c.type === "uuid"
            ? 40
            : c.type === "datetime"
              ? 30
              : c.type === "typedJson"
                ? 60
                : 23,
      style: {
        numFmt: numeric.has(c.type)
          ? c.type === "unitMoney" || c.type === "percent"
            ? "0.0000"
            : "0"
          : "@",
        fill: {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb: !c.editable
              ? fills.system
              : c.required
                ? fills.required
                : fills.optional,
          },
        },
        alignment: { vertical: "top", wrapText: true },
      },
    }));
    const header = sheet.getRow(1);
    header.height = 32;
    header.eachCell((cell, index) => {
      const c = spec.columns[index - 1];
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF275C50" },
      };
      cell.font = { color: { argb: "FFFFFFFF" }, bold: true, size: 11 };
      cell.note = `${!c.editable ? "系統管理，不可自行修改" : c.required ? "必填" : "選填／可能條件必填"}\n型別：${c.type}${c.target ? `\n參照：${c.target}；填new:代號或code:編號` : ""}${c.options ? `\n選項：${contract.options[c.options].join("、")}` : ""}`;
    });
    if (spec.kind === "instructions") {
      for (const item of instructions) sheet.addRow(item);
      sheet.addRow([
        "工作表索引",
        "以下列出每張表用途；新手先從參與方、企劃及商品開始。",
      ]);
      for (const s of contract.sheets.slice(1))
        sheet.addRow([
          s.name,
          s.kind === "system" || s.kind === "computed"
            ? "系統管理／計算結果，不需填寫。"
            : s.kind === "deferred"
              ? "後續功能預留，現階段不填寫。"
              : `資料類型：${s.entity ?? s.kind}；欄位用途請查看該表表頭註解。`,
        ]);
    } else if (spec.name === "01_格式資訊") {
      sheet.addRow({
        formatName: contract.formatName,
        formatVersion: contract.formatVersion,
        fileKind: kind === "example" ? "虛構範例" : "空白模板",
        documentId: randomUUID(),
        appVersion: "0.1.0",
      });
    } else if (spec.name === "99_選項字典") {
      dictionary.forEach((r) => sheet.addRow(r));
    } else if (
      kind === "example" &&
      spec.entity &&
      fixture.newRows[spec.entity]
    ) {
      for (const source of fixture.newRows[spec.entity]) {
        const row = { ...source };
        for (const column of spec.columns) {
          if (numeric.has(column.type) && row[column.key] !== undefined)
            row[column.key] = Number(row[column.key]);
        }
        sheet.addRow(row);
      }
    }
    if (spec.kind !== "instructions")
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: spec.columns.length },
      };
    // Apply input guidance to the first 100 entry rows, not an Excel security boundary.
    if (spec.entity)
      spec.columns.forEach((column, index) => {
        if (!column.editable) return;
        for (let r = 2; r <= 101; r++) {
          if (column.options)
            sheet.getCell(r, index + 1).dataValidation = {
              type: "list",
              allowBlank: true,
              formulae: [optionRanges[column.options]],
              showErrorMessage: true,
              errorTitle: "請使用指定選項",
              error: "請從下拉選單選取，完整驗證由ConMate執行。",
            };
        }
      });
  }
  return workbook;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const kind of ["blank", "example"]) {
    const workbook = await generateTemplate(kind);
    await writeFile(
      new URL(`conmate-${kind}-v1.xlsx`, directory),
      await workbook.xlsx.writeBuffer(),
    );
    console.log(
      `Generated ${kind}: ${workbook.worksheets.length} visible worksheets`,
    );
  }
}
