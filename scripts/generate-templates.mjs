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
const guide = JSON.parse(
  await readFile(new URL("docs/contracts/template-guide.json", root), "utf8"),
);
const appPackage = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
);
await mkdir(directory, { recursive: true });
const font = {
  name: "Microsoft JhengHei",
  size: 12,
  color: { argb: "FF24382E" },
};
const border = Object.fromEntries(
  ["top", "left", "bottom", "right"].map((side) => [
    side,
    { style: "thin", color: { argb: "FFB4BEB5" } },
  ]),
);

// Importers identify columns by their unchanged labels, never by their position.
function displayColumns(spec) {
  if (!spec.entity) return spec.columns;
  return [
    ...["tempKey", "operation"].map((key) =>
      spec.columns.find((c) => c.key === key),
    ),
    ...spec.columns.filter(
      (c) => c.editable && !["tempKey", "operation"].includes(c.key),
    ),
    ...spec.columns.filter((c) => !c.editable),
  ];
}

function columnHelp(spec, column) {
  if (!column.editable)
    return "系統管理欄位：請勿自行修改。新增資料留白，匯入後由 ConMate 產生。";
  const common = {
    tempKey:
      "替這一列取一個好記、不重複的代號，例如星狐徽章；其他表用 new:星狐徽章 連過來。不是正式 ID。",
    operation:
      "第一次建立資料請選「新增」。不要為了複製新商品而沿用別列的正式 ID。",
    ratio:
      "填百分比數值；100 表示全部擁有，20 表示 20%。商品權益不是分潤比例。",
    isCreator: "這個人是創作者填文字 TRUE；廠商或其他對象填文字 FALSE。",
    trackingMode:
      "一般商品選「批次」；只有需要逐件辨識的親簽、限量編號商品才選「單件」。",
    name: `填${spec.name.slice(3)}的名稱，讓自己看得懂，不用編正式 ID。`,
  };
  let text = common[column.key];
  if (!text && column.type === "reference") {
    const target = contract.sheets.find((s) => s.entity === column.target);
    text = `先在「${target?.name ?? "系統紀錄"}」建立資料，再填 new:該列新增代號。已有系統編號則填 code:編號；不能填列號。`;
  }
  const typeHelp = {
    text: "填一般文字；備註可不填，代號與名稱請保持一致。",
    money: "填整數金額，例如 600；不要加 NT$、元、逗號或公式。",
    signedMoney: "填整數金額：應取得為正，應繳回為負；不要加單位或公式。",
    unitMoney: "填每件金額或權重，最多四位小數，例如 20 或 46.7836，不加單位。",
    quantity: "填整數件數，例如 30；不要加「個」。空白表示未提供，不等於 0。",
    positiveInteger: "填大於零的整數。",
    percent: "填 0 至 100 的數值；20 表示 20%，不要填成 0.2 或輸入百分比格式。",
    date: "以純文字填 YYYY-MM-DD，例如 2027-01-10；不填試算表日期序號。",
    datetime: "以純文字填日期時間與時區，例如 2027-01-10T10:00:00+08:00。",
    booleanText: "填文字 TRUE 或 FALSE，不填 1、0 或公式。",
    enum: "從下拉選單選一項，不用自行編寫英文代碼。",
  };
  text ??= typeHelp[column.type] ?? "依說明填入純值，不要輸入公式。";
  const sample = fixture.newRows[spec.entity]?.find(
    (r) => r[column.key] !== undefined,
  )?.[column.key];
  return `${column.required ? "必填" : "選填／條件必填"}｜${column.label}\n${text}${sample !== undefined ? `\n範例：${sample}` : ""}${column.options ? `\n可選：${contract.options[column.options].join("、")}` : ""}`;
}

function guideRows() {
  const rows = [
    [
      "先別急著填 66 張表",
      "只要先看下面的「星狐徽章」主線。先建商品，費用、販售、盤點等資料等需要時再填；灰色系統欄一律先留白。",
    ],
    [
      "新版從左邊開始填",
      "每張資料表左側依序是「新增代號」「操作」及商品資料；正式 ID、修訂號、時間已移到最右側。第 1 列仍是欄名，第 2 列開始填。",
    ],
    [
      "怎麼看下面的例子",
      "主線範例在同名工作表第 2 列，也可用「新增代號」找對應列。空白模板每筆資料填一列；同一張表新增下一筆時填下一空白列，不要覆蓋原列。不用把說明文字貼進資料區。",
    ],
  ];
  for (const [index, step] of guide.starterSteps.entries()) {
    const spec = contract.sheets.find((s) => s.name === step.sheet);
    const columns = displayColumns(spec);
    const entries = step.fields.map((field) => {
      const letter = columnLetter(
        columns.findIndex((c) => c.key === field.key) + 1,
      );
      return `${letter}2「${field.label}」：${field.value}`;
    });
    rows.push([
      `先填 ${index + 1}｜${step.sheet}\n${step.title}`,
      `${step.explanation}\n照填第 2 列：\n${entries.join("\n")}\n其餘選填可先留白，最右側灰色系統欄不要填。`,
    ]);
  }
  rows.push([
    "一個徽章已經連起來了",
    "星狐（創作者）→星夜（企劃）→徽章（種類）→58mm（規格）→星狐徽章系列→星狐徽章（實際款式）。商品權益表記錄它屬於星狐。這些不是已入庫或已售出紀錄。",
  ]);
  rows.push([
    "接著才填：柄圖與製作",
    "有圖稿再填 13、14、17；要記製作數量再填 19、20。下方各列用同一個星狐徽章接續示範。其他進階工作表先不必填。",
  ]);
  for (const step of guide.optionalSteps) {
    rows.push([
      `選填｜${step.sheet}\n${step.title}`,
      `${step.explanation}\n${step.fields.map((f) => `「${f.label}」：${f.value}`).join("\n")}`,
    ]);
  }
  return rows;
}

function columnLetter(number) {
  let result = "";
  while (number) {
    number--;
    result = String.fromCharCode(65 + (number % 26)) + result;
    number = Math.floor(number / 26);
  }
  return result;
}
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
  workbook.views = [{ activeTab: 0, firstSheet: 0, visibility: "visible" }];
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
    const columns = displayColumns(spec);
    const sheet = workbook.addWorksheet(spec.name, {
      state: "visible",
      views: [
        {
          state: "frozen",
          ySplit: 1,
          xSplit: spec.entity ? 2 : 0,
          showGridLines: true,
          zoomScale: 100,
        },
      ],
      properties: {
        defaultRowHeight: 30,
        tabColor: {
          argb: guide.starterSteps.some((s) => s.sheet === spec.name)
            ? "FF518269"
            : !spec.entity
              ? "FF9AA19C"
              : "FFD5B569",
        },
      },
      pageSetup: {
        paperSize: 9,
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        showGridLines: true,
      },
    });
    sheet.columns = columns.map((c) => ({
      header: c.label,
      key: c.key,
      width:
        c.key === "description"
          ? 100
          : c.type === "uuid"
            ? 40
            : c.type === "datetime"
              ? 30
              : c.type === "typedJson"
                ? 60
                : c.key === "operation"
                  ? 14
                  : c.type === "date"
                    ? 18
                    : 26,
      style: {
        font,
        border,
        numFmt: numeric.has(c.type)
          ? c.type === "unitMoney" || c.type === "percent"
            ? "0.0000"
            : "0"
          : "@",
        fill: {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb:
              spec.kind === "instructions"
                ? "FFFFFFFF"
                : !c.editable
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
    header.height = 36;
    header.eachCell((cell, index) => {
      const c = columns[index - 1];
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF275C50" },
      };
      cell.font = { ...font, color: { argb: "FFFFFFFF" }, bold: true };
      cell.note = { texts: [{ font, text: columnHelp(spec, c) }] };
    });
    if (spec.kind === "instructions") {
      sheet.addRow(instructions[0]);
      for (const item of guideRows()) sheet.addRow(item);
      for (const item of instructions.slice(1)) sheet.addRow(item);
      sheet.addRow([
        "工作表索引",
        "以下列出每張表用途；新手先從參與方、企劃及商品開始。",
      ]);
      for (const s of contract.sheets.slice(1))
        sheet.addRow([s.name, guide.sheetPurposes[s.name]]);
    } else if (spec.name === "01_格式資訊") {
      sheet.addRow({
        formatName: contract.formatName,
        formatVersion: contract.formatVersion,
        fileKind: kind === "example" ? "虛構範例" : "空白模板",
        documentId: randomUUID(),
        appVersion: appPackage.version,
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
        to: { row: 1, column: columns.length },
      };
    // Apply input guidance to the first 100 entry rows, not an Excel security boundary.
    if (spec.entity)
      columns.forEach((column, index) => {
        if (!column.editable) return;
        for (let r = 2; r <= 101; r++) {
          sheet.getCell(r, index + 1).dataValidation = {
            type: column.options ? "list" : "any",
            allowBlank: true,
            ...(column.options
              ? { formulae: [optionRanges[column.options]] }
              : {}),
            showInputMessage: true,
            promptTitle: `${column.required ? "必填" : "選填"}：${column.label}`,
            prompt: columnHelp(spec, column).slice(0, 250),
            showErrorMessage: true,
            errorTitle: "請使用指定選項",
            error: "請從下拉選單選取，完整驗證由ConMate執行。",
          };
        }
      });
    // Fills hide native Excel gridlines: draw real borders, including blank entry cells.
    const lastRow = spec.entity
      ? Math.max(101, sheet.rowCount)
      : sheet.rowCount;
    for (let r = 2; r <= lastRow; r++) {
      const row = sheet.getRow(r);
      row.height = 30;
      for (let c = 1; c <= columns.length; c++) {
        const cell = row.getCell(c);
        cell.font = font;
        cell.border = border;
      }
      if (spec.kind === "instructions") {
        const text = row.getCell(2).text;
        const lines = text
          .split("\n")
          .reduce(
            (sum, line) =>
              sum +
              Math.max(
                1,
                Math.ceil(
                  [...line].reduce(
                    (n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1),
                    0,
                  ) / 90,
                ),
              ),
            0,
          );
        row.height = Math.max(36, lines * 19 + 12);
      } else {
        // Long names and notes must not be clipped by the default input-row height.
        let lines = 1;
        for (let c = 1; c <= columns.length; c++) {
          const width = Math.max(10, sheet.getColumn(c).width - 2);
          const count = row
            .getCell(c)
            .text.split("\n")
            .reduce(
              (sum, line) =>
                sum +
                Math.max(
                  1,
                  Math.ceil(
                    [...line].reduce(
                      (n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1),
                      0,
                    ) / width,
                  ),
                ),
              0,
            );
          lines = Math.max(lines, count);
        }
        row.height = Math.min(409, Math.max(30, lines * 19 + 10));
      }
    }
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
