import type { CatalogSnapshot } from "../domain/models/catalog";
import { putField, putProduct, putTag } from "../domain/catalog/operations";
import { putArtwork, putParty } from "../domain/catalog/masterdata";
import { putEvent, putProject } from "../domain/catalog/projects";
import type {
  ArtworkInput,
  EventInput,
  FieldInput,
  FieldType,
} from "../domain/models/catalog";
import { validateRestoreSnapshot } from "../domain/validation/restore";
import { catalogRepository } from "../infrastructure/storage/catalog";
import {
  type MasterDataImportDocument,
  type MasterDataImportIssue,
  type MasterDataImportParty,
  type MasterDataImportProject,
  type MasterDataImportProduct,
  type MasterDataImportSource,
  type MasterDataImportEvent,
  type MasterDataImportArtwork,
  type MasterDataImportTag,
  type MasterDataImportField,
  type MasterDataImportOption,
} from "../infrastructure/excel/master-data-import";

export type {
  MasterDataImportDocument,
  MasterDataImportIssue,
} from "../infrastructure/excel/master-data-import";

export interface MasterDataImportChange {
  entity:
    | "參與方"
    | "企劃"
    | "場次"
    | "柄圖"
    | "標記"
    | "自訂欄位"
    | "欄位選項"
    | "商品";
  operation: "新增" | "更新";
  id: string;
  code: string;
  name: string;
  fields: { name: string; before: string; after: string }[];
}

export interface MasterDataImportPreview {
  changes: MasterDataImportChange[];
  issues: MasterDataImportIssue[];
}

const SHEETS = {
  parties: "01_參與方",
  projects: "02_企劃",
  products: "03_商品",
  events: "04_場次",
  artworks: "05_柄圖",
  tags: "06_標記",
  fields: "07_自訂欄位",
  options: "08_欄位選項",
} as const;

function issue(
  issues: MasterDataImportIssue[],
  sheet: string,
  code: string,
  message: string,
  suggestion: string,
  row?: number,
  column?: string,
) {
  issues.push({ sheet, row, column, code, message, suggestion });
}

function label(value: unknown): string {
  if (Array.isArray(value)) return value.join("、");
  if (value === null || value === undefined) return "";
  return String(value);
}

function change(
  changes: MasterDataImportChange[],
  entity: MasterDataImportChange["entity"],
  operation: MasterDataImportChange["operation"],
  record: { id: string; code: string; name: string },
  fields: MasterDataImportChange["fields"],
) {
  if (operation === "新增" || fields.length)
    changes.push({ entity, operation, ...record, fields });
}

function validateIdentityRows<
  T extends { id: string; alias: string; sourceRow: number },
>(
  rows: T[],
  records: { id: string }[],
  sheet: string,
  issues: MasterDataImportIssue[],
) {
  const ids = new Set<string>();
  const aliases = new Set<string>();
  for (const row of rows) {
    if (row.id) {
      if (ids.has(row.id))
        issue(
          issues,
          sheet,
          "duplicate-id",
          "資料ID在同一工作表重複。",
          "每筆既有資料只能保留一列。",
          row.sourceRow,
          "資料ID",
        );
      ids.add(row.id);
      if (!records.some((record) => record.id === row.id))
        issue(
          issues,
          sheet,
          "unknown-id",
          "資料ID不屬於此工作區或已不存在。",
          "請從目前工作區重新下載匯入範本，不要自行修改資料ID。",
          row.sourceRow,
          "資料ID",
        );
      if (row.alias)
        issue(
          issues,
          sheet,
          "alias-on-existing",
          "新增代號只可用於新增資料。",
          "既有資料請保留資料ID並清空新增代號。",
          row.sourceRow,
          "新增代號",
        );
    } else {
      const key = row.alias.trim().toLocaleLowerCase("en-US");
      if (aliases.has(key))
        issue(
          issues,
          sheet,
          "duplicate-alias",
          "新增代號在同一工作表重複。",
          "每筆新增資料使用不同代號。",
          row.sourceRow,
          "新增代號",
        );
      aliases.add(key);
    }
  }
  for (const record of records)
    if (!ids.has(record.id))
      issue(
        issues,
        sheet,
        "missing-existing-row",
        "匯入表缺少目前工作區的既有資料列；不支援以刪列刪除資料。",
        "請補回該列。若要封存資料，請在網站操作。",
      );
}

function rowField(
  fields: MasterDataImportChange["fields"],
  name: string,
  before: unknown,
  after: unknown,
) {
  const oldValue = label(before);
  const newValue = label(after);
  if (oldValue !== newValue)
    fields.push({ name, before: oldValue, after: newValue });
}

function aliasIndex<T extends { id: string; alias: string }>(
  rows: T[],
): Map<string, T> {
  return new Map(
    rows
      .filter((row) => !row.id && row.alias)
      .map((row) => [row.alias.trim().toLocaleLowerCase("en-US"), row]),
  );
}

function resolveReference<T extends { id: string }>(
  raw: string,
  records: T[],
  aliases: Map<string, { id: string }>,
  sheet: string,
  row: number,
  column: string,
  issues: MasterDataImportIssue[],
): string {
  const value = raw.trim();
  if (!value) return "";
  if (value.startsWith("new:")) {
    const alias = value.slice(4).trim().toLocaleLowerCase("en-US");
    const match = aliases.get(alias);
    if (match) return match.id;
  } else if (records.some((record) => record.id === value)) {
    return value;
  }
  issue(
    issues,
    sheet,
    "invalid-reference",
    `參照「${value}」不存在或不屬於此工作區。`,
    "請填入有效資料ID；同檔新增資料使用 new:新增代號。",
    row,
    column,
  );
  return "";
}

function separated(value: string) {
  return value
    .split("、")
    .map((item) => item.trim())
    .filter(Boolean);
}

function assertArchiveStatus(
  imported: { id: string; status: string; sourceRow: number }[],
  records: { id: string; archived: boolean }[],
  sheet: string,
  issues: MasterDataImportIssue[],
) {
  const expected = new Map(
    records.map((record) => [record.id, record.archived ? "已封存" : "使用中"]),
  );
  for (const row of imported) {
    const status = expected.get(row.id);
    if (status !== undefined && status !== row.status)
      issue(
        issues,
        sheet,
        "archive-status-readonly",
        "匯入不支援變更封存狀態。",
        "請在網站使用封存／恢復操作。",
        row.sourceRow,
        "狀態",
      );
    else if (!row.id && row.status !== "使用中")
      issue(
        issues,
        sheet,
        "invalid-new-status",
        "新增資料的狀態只能是「使用中」。",
        "請使用「使用中」；如需封存，請在網站新增後操作。",
        row.sourceRow,
        "狀態",
      );
  }
}

function applyDocument(
  snapshot: CatalogSnapshot,
  document: MasterDataImportDocument,
): MasterDataImportPreview {
  const changes: MasterDataImportChange[] = [];
  const issues: MasterDataImportIssue[] = [];
  if (snapshot.workspaceId !== document.workspaceId)
    issue(
      issues,
      "00_匯入說明",
      "workspace-mismatch",
      "匯入檔屬於不同工作區。",
      "請切換到來源工作區，或重新下載目前工作區的匯入範本。",
    );
  if (snapshot.revision !== document.baseRevision)
    issue(
      issues,
      "00_匯入說明",
      "stale-revision",
      "範本下載後工作區已有變更，不能套用舊資料。",
      "重新下載範本並再次編輯，避免覆蓋其他畫面的新資料。",
    );

  validateIdentityRows(
    document.parties,
    snapshot.parties,
    SHEETS.parties,
    issues,
  );
  validateIdentityRows(
    document.projects,
    snapshot.projects,
    SHEETS.projects,
    issues,
  );
  validateIdentityRows(document.events, snapshot.events, SHEETS.events, issues);
  validateIdentityRows(
    document.products,
    snapshot.products,
    SHEETS.products,
    issues,
  );
  validateIdentityRows(
    document.artworks,
    snapshot.artworks,
    SHEETS.artworks,
    issues,
  );
  validateIdentityRows(document.tags, snapshot.tags, SHEETS.tags, issues);
  validateIdentityRows(document.fields, snapshot.fields, SHEETS.fields, issues);
  assertArchiveStatus(document.tags, snapshot.tags, SHEETS.tags, issues);
  assertArchiveStatus(document.events, snapshot.events, SHEETS.events, issues);
  assertArchiveStatus(
    document.artworks,
    snapshot.artworks,
    SHEETS.artworks,
    issues,
  );
  assertArchiveStatus(document.fields, snapshot.fields, SHEETS.fields, issues);
  const optionIds = new Set<string>();
  const optionAliases = new Set<string>();
  const optionsByField = new Map<string, MasterDataImportOption[]>();
  for (const option of document.options) {
    const field = option.fieldId
      ? snapshot.fields.find((item) => item.id === option.fieldId)
      : document.fields.find(
          (item) =>
            !item.id &&
            item.alias.toLocaleLowerCase("en-US") ===
              option.fieldAlias.toLocaleLowerCase("en-US"),
        );
    if (!field)
      issue(
        issues,
        SHEETS.options,
        "invalid-field-reference",
        "欄位選項參照的欄位不存在或不屬於此工作區。",
        "請使用欄位ID或同檔新增欄位代號。",
        option.sourceRow,
      );
    if (option.id) {
      if (optionIds.has(option.id))
        issue(
          issues,
          SHEETS.options,
          "duplicate-option-id",
          "選項ID重複。",
          "每個既有選項只保留一列。",
          option.sourceRow,
          "選項ID",
        );
      optionIds.add(option.id);
    }
    if (option.alias) {
      const key = `${option.fieldId || `new:${option.fieldAlias.toLocaleLowerCase("en-US")}`}:${option.alias.toLocaleLowerCase("en-US")}`;
      if (optionAliases.has(key))
        issue(
          issues,
          SHEETS.options,
          "duplicate-option-alias",
          "同一欄位中的選項新增代號重複。",
          "每個新選項使用唯一代號。",
          option.sourceRow,
          "選項新增代號",
        );
      optionAliases.add(key);
    }
    const key =
      option.fieldId || `new:${option.fieldAlias.toLocaleLowerCase("en-US")}`;
    optionsByField.set(key, [...(optionsByField.get(key) || []), option]);
  }
  for (const field of document.fields) {
    const key = field.id || `new:${field.alias.toLocaleLowerCase("en-US")}`;
    const options = optionsByField.get(key) || [];
    if (
      !["text", "number", "single", "multi", "boolean", "date"].includes(
        field.type,
      )
    )
      issue(
        issues,
        SHEETS.fields,
        "invalid-field-type",
        "不支援此自訂欄位類型。",
        "欄位類型請使用 text、number、single、multi、boolean 或 date。",
        field.sourceRow,
        "欄位類型",
      );
    if (field.type !== "single" && field.type !== "multi" && options.length)
      issue(
        issues,
        SHEETS.options,
        "options-not-supported",
        "此欄位類型不接受選項。",
        "文字、數字、是／否與日期欄位請移除選項列。",
      );
    if (
      (field.type === "single" || field.type === "multi") &&
      !options.some((option) => option.status === "使用中")
    )
      issue(
        issues,
        SHEETS.options,
        "missing-active-option",
        "單選或多選欄位至少需要一個使用中選項。",
        "新增或恢復至少一個有效選項。",
        field.sourceRow,
      );
    const previous = field.id
      ? snapshot.fields.find((item) => item.id === field.id)
      : undefined;
    if (previous && previous.type !== field.type)
      issue(
        issues,
        SHEETS.fields,
        "field-type-immutable",
        "既有自訂欄位類型不能直接變更。",
        "如需其他類型，請新增欄位並在網站逐步遷移資料。",
        field.sourceRow,
        "欄位類型",
      );
    for (const option of options)
      if (!["使用中", "已封存"].includes(option.status))
        issue(
          issues,
          SHEETS.options,
          "invalid-option-status",
          "選項狀態只能是「使用中」或「已封存」。",
          "請更正狀態文字。",
          option.sourceRow,
          "狀態",
        );
    if (previous)
      for (const oldOption of previous.options)
        if (!options.some((option) => option.id === oldOption.id))
          issue(
            issues,
            SHEETS.options,
            "missing-existing-option",
            "選項列缺少既有選項 ID；不支援刪除選項。",
            "請補回該列，或將狀態設為「已封存」。",
          );
  }
  const knownOptionIds = new Set(
    snapshot.fields.flatMap((field) =>
      field.options.map((option) => option.id),
    ),
  );
  for (const option of document.options)
    if (option.id && !knownOptionIds.has(option.id))
      issue(
        issues,
        SHEETS.options,
        "unknown-option-id",
        "選項ID不屬於此工作區。",
        "請使用目前工作區匯出的選項ID。",
        option.sourceRow,
        "選項ID",
      );
  if (issues.length) return { changes, issues };

  const partyAliases = aliasIndex(document.parties);
  const projectAliases = aliasIndex(document.projects);
  const artworkAliases = aliasIndex(document.artworks);
  const tagAliases = aliasIndex(document.tags);
  const createdPartyIds = new Map<string, string>();
  const createdProjectIds = new Map<string, string>();
  const createdArtworkIds = new Map<string, string>();
  const createdTagIds = new Map<string, string>();
  const allowedChanges = new Set([
    "parties",
    "projects",
    "events",
    "projectEvents",
    "products",
    "productTypes",
    "specs",
    "series",
    "artworks",
    "tags",
    "fields",
    "counters",
  ]);
  const protectedBefore = JSON.stringify(
    Object.fromEntries(
      Object.entries(snapshot).filter(([key]) => !allowedChanges.has(key)),
    ),
  );

  for (const row of document.parties) {
    const previous = row.id
      ? snapshot.parties.find((party) => party.id === row.id)
      : undefined;
    const previousValues = previous
      ? { name: previous.name, notes: previous.notes }
      : undefined;
    try {
      const next = putParty(
        snapshot,
        { name: row.name, notes: row.notes },
        row.id || undefined,
      );
      if (!row.id)
        createdPartyIds.set(
          row.alias.trim().toLocaleLowerCase("en-US"),
          next.id,
        );
      change(
        changes,
        "參與方",
        previous ? "更新" : "新增",
        next,
        previousValues
          ? [
              ["名稱", previousValues.name, next.name],
              ["備註", previousValues.notes, next.notes],
            ].flatMap(([name, before, after]) =>
              before === after ? [] : [{ name, before, after }],
            )
          : [
              { name: "名稱", before: "", after: next.name },
              { name: "備註", before: "", after: next.notes },
            ],
      );
    } catch (error) {
      issue(
        issues,
        SHEETS.parties,
        "invalid-party",
        error instanceof Error ? error.message : "參與方資料不正確。",
        "修正名稱或備註後重新檢查。",
        row.sourceRow,
      );
    }
  }

  for (const row of document.projects) {
    const previous = row.id
      ? snapshot.projects.find((project) => project.id === row.id)
      : undefined;
    const previousValues = previous
      ? { name: previous.name, description: previous.description }
      : undefined;
    try {
      const next = putProject(
        snapshot,
        { name: row.name, description: row.description },
        row.id || undefined,
      );
      if (!row.id)
        createdProjectIds.set(
          row.alias.trim().toLocaleLowerCase("en-US"),
          next.id,
        );
      change(
        changes,
        "企劃",
        previous ? "更新" : "新增",
        next,
        previousValues
          ? [
              ["名稱", previousValues.name, next.name],
              ["說明", previousValues.description, next.description],
            ].flatMap(([name, before, after]) =>
              before === after ? [] : [{ name, before, after }],
            )
          : [
              { name: "名稱", before: "", after: next.name },
              { name: "說明", before: "", after: next.description },
            ],
      );
    } catch (error) {
      issue(
        issues,
        SHEETS.projects,
        "invalid-project",
        error instanceof Error ? error.message : "企劃資料不正確。",
        "修正名稱或說明後重新檢查。",
        row.sourceRow,
      );
    }
  }

  const partyRefs = new Map<string, { id: string }>(
    snapshot.parties.map((party) => [party.id, party]),
  );
  const projectRefs = new Map<string, { id: string }>(
    snapshot.projects.map((project) => [project.id, project]),
  );
  const partiesByAlias = new Map<string, { id: string }>(
    [...partyAliases].map(([alias, row]) => [
      alias,
      { id: createdPartyIds.get(alias) || "" },
    ]),
  );
  const projectsByAlias = new Map<string, { id: string }>(
    [...projectAliases].map(([alias, row]) => [
      alias,
      { id: createdProjectIds.get(alias) || "" },
    ]),
  );
  for (const row of document.events) {
    const previous = row.id
      ? snapshot.events.find((event) => event.id === row.id)
      : undefined;
    const previousValues = previous
      ? structuredClone({
          name: previous.name,
          startDate: previous.startDate,
          endDate: previous.endDate,
          venue: previous.venue,
          notes: previous.notes,
          archived: previous.archived,
          projectIds: snapshot.projectEvents
            .filter((link) => link.eventId === previous.id)
            .map((link) => link.projectId),
        })
      : undefined;
    const projectIds = separated(row.projectIds).map((reference) =>
      resolveReference(
        reference,
        [...projectRefs.values()],
        projectsByAlias,
        SHEETS.events,
        row.sourceRow,
        "參加企劃ID（以、分隔）",
        issues,
      ),
    );
    if (new Set(projectIds).size !== projectIds.length)
      issue(
        issues,
        SHEETS.events,
        "duplicate-project-reference",
        "參加企劃不可重複。",
        "每個企劃只保留一個 ID。",
        row.sourceRow,
        "參加企劃ID（以、分隔）",
      );
    const normalized = {
      name: row.name.trim(),
      startDate: row.startDate.trim(),
      endDate: row.endDate.trim(),
      venue: row.venue.trim(),
      notes: row.notes.trim(),
      projectIds,
    };
    const unchanged =
      previousValues &&
      previousValues.name === normalized.name &&
      previousValues.startDate === normalized.startDate &&
      previousValues.endDate === normalized.endDate &&
      previousValues.venue === normalized.venue &&
      previousValues.notes === normalized.notes &&
      JSON.stringify([...previousValues.projectIds].sort()) ===
        JSON.stringify([...projectIds].sort());
    if (unchanged) continue;
    if (previousValues?.archived) {
      issue(
        issues,
        SHEETS.events,
        "archived-event-locked",
        "封存場次不能透過匯入修改。",
        "請先在網站恢復場次，再下載新範本。",
        row.sourceRow,
      );
      continue;
    }
    if (
      previous &&
      snapshot.sales.some((sale) => sale.eventId === previous.id)
    ) {
      issue(
        issues,
        SHEETS.events,
        "historical-event-locked",
        "已有交易使用此場次，匯入不允許修改該場次或參場企劃。",
        "請保留原場次；需要不同資料時新增場次。",
        row.sourceRow,
      );
      continue;
    }
    if (projectIds.some((id) => !id)) continue;
    try {
      const input: EventInput = {
        ...normalized,
      };
      const next = putEvent(snapshot, input, row.id || undefined);
      const fields: MasterDataImportChange["fields"] = [];
      rowField(fields, "場次名稱", previousValues?.name || "", next.name);
      rowField(
        fields,
        "開始日期",
        previousValues?.startDate || "",
        next.startDate,
      );
      rowField(fields, "結束日期", previousValues?.endDate || "", next.endDate);
      rowField(fields, "地點", previousValues?.venue || "", next.venue);
      rowField(fields, "備註", previousValues?.notes || "", next.notes);
      rowField(
        fields,
        "參加企劃",
        (previousValues?.projectIds || [])
          .map(
            (id) =>
              snapshot.projects.find((project) => project.id === id)?.name ||
              id,
          )
          .sort(),
        projectIds
          .map(
            (id) =>
              snapshot.projects.find((project) => project.id === id)?.name ||
              id,
          )
          .sort(),
      );
      change(changes, "場次", previous ? "更新" : "新增", next, fields);
    } catch (error) {
      issue(
        issues,
        SHEETS.events,
        "invalid-event",
        error instanceof Error ? error.message : "場次資料不正確。",
        "修正場次日期、內容或企劃參照後重新檢查。",
        row.sourceRow,
      );
    }
  }

  for (const row of document.artworks) {
    const rowIssueCount = issues.length;
    const previous = row.id
      ? snapshot.artworks.find((artwork) => artwork.id === row.id)
      : undefined;
    const previousValues = previous ? structuredClone(previous) : undefined;
    const projectId = resolveReference(
      row.projectId,
      [...projectRefs.values()],
      projectsByAlias,
      SHEETS.artworks,
      row.sourceRow,
      "企劃ID",
      issues,
    );
    const authorIds = separated(row.authorIds).map((reference) =>
      resolveReference(
        reference,
        [...partyRefs.values()],
        partiesByAlias,
        SHEETS.artworks,
        row.sourceRow,
        "作者ID（以、分隔）",
        issues,
      ),
    );
    if (new Set(authorIds).size !== authorIds.length)
      issue(
        issues,
        SHEETS.artworks,
        "duplicate-author",
        "柄圖作者不可重複。",
        "每位作者只保留一個 ID。",
        row.sourceRow,
        "作者ID（以、分隔）",
      );
    if (issues.length > rowIssueCount) continue;
    if (previous?.archived && previousValues) {
      const unchanged =
        previousValues.name === row.name.trim() &&
        previousValues.projectId === projectId &&
        JSON.stringify([...previousValues.authorIds].sort()) ===
          JSON.stringify([...authorIds].sort()) &&
        previousValues.notes === row.notes.trim();
      if (!unchanged)
        issue(
          issues,
          SHEETS.artworks,
          "archived-artwork-locked",
          "封存柄圖不能透過匯入修改。",
          "請先在網站恢復柄圖，再下載新範本。",
          row.sourceRow,
        );
      continue;
    }
    const input: ArtworkInput = {
      name: row.name,
      projectId,
      authorIds,
      notes: row.notes,
    };
    try {
      const next = putArtwork(snapshot, input, row.id || undefined);
      if (!row.id)
        createdArtworkIds.set(
          row.alias.trim().toLocaleLowerCase("en-US"),
          next.id,
        );
      const fields: MasterDataImportChange["fields"] = [];
      rowField(fields, "柄圖名稱", previousValues?.name || "", next.name);
      rowField(
        fields,
        "企劃",
        previousValues?.projectId
          ? snapshot.projects.find(
              (project) => project.id === previousValues.projectId,
            )?.name
          : "",
        next.projectId
          ? snapshot.projects.find((project) => project.id === next.projectId)
              ?.name
          : "",
      );
      rowField(
        fields,
        "作者",
        (previousValues?.authorIds || [])
          .map(
            (id) =>
              snapshot.parties.find((party) => party.id === id)?.name || id,
          )
          .sort(),
        next.authorIds
          .map(
            (id) =>
              snapshot.parties.find((party) => party.id === id)?.name || id,
          )
          .sort(),
      );
      rowField(fields, "備註", previousValues?.notes || "", next.notes);
      change(changes, "柄圖", previous ? "更新" : "新增", next, fields);
    } catch (error) {
      issue(
        issues,
        SHEETS.artworks,
        "invalid-artwork",
        error instanceof Error ? error.message : "柄圖資料不正確。",
        "修正企劃、作者或名稱後重新檢查。",
        row.sourceRow,
      );
    }
  }

  for (const row of document.tags) {
    const previous = row.id
      ? snapshot.tags.find((tag) => tag.id === row.id)
      : undefined;
    if (previous?.archived) {
      if (previous.name !== row.name.trim())
        issue(
          issues,
          SHEETS.tags,
          "archived-tag-locked",
          "封存標記不能透過匯入修改。",
          "請先在網站恢復標記，再下載新範本。",
          row.sourceRow,
        );
      continue;
    }
    try {
      const previousName = previous?.name || "";
      putTag(snapshot, row.name, previous?.id);
      const next = previous
        ? snapshot.tags.find((tag) => tag.id === previous.id)
        : snapshot.tags.find((tag) => tag.name === row.name.trim());
      if (!next) throw new Error("標記寫入後找不到資料。");
      if (!row.id)
        createdTagIds.set(row.alias.trim().toLocaleLowerCase("en-US"), next.id);
      change(
        changes,
        "標記",
        previous ? "更新" : "新增",
        next,
        previous
          ? previousName === next.name
            ? []
            : [{ name: "名稱", before: previousName, after: next.name }]
          : [{ name: "名稱", before: "", after: next.name }],
      );
    } catch (error) {
      issue(
        issues,
        SHEETS.tags,
        "invalid-tag",
        error instanceof Error ? error.message : "標記資料不正確。",
        "修正標記名稱後重新檢查。",
        row.sourceRow,
      );
    }
  }

  const optionsByFieldKey = new Map<string, MasterDataImportOption[]>();
  for (const option of document.options) {
    const key =
      option.fieldId || `new:${option.fieldAlias.toLocaleLowerCase("en-US")}`;
    optionsByFieldKey.set(key, [...(optionsByFieldKey.get(key) || []), option]);
  }
  for (const row of document.fields) {
    const previous = row.id
      ? snapshot.fields.find((field) => field.id === row.id)
      : undefined;
    const previousValues = previous ? structuredClone(previous) : undefined;
    const rows =
      optionsByFieldKey.get(
        row.id || `new:${row.alias.toLocaleLowerCase("en-US")}`,
      ) || [];
    if (previousValues?.archived) {
      const oldOptions = previousValues.options
        .map((option) => ({
          id: option.id,
          label: option.label,
          status: option.archived ? "已封存" : "使用中",
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
      const importedOptions = rows
        .map((option) => ({
          id: option.id,
          label: option.label.trim(),
          status: option.status,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
      if (
        previousValues.name !== row.name.trim() ||
        previousValues.type !== row.type ||
        JSON.stringify(oldOptions) !== JSON.stringify(importedOptions)
      )
        issue(
          issues,
          SHEETS.fields,
          "archived-field-locked",
          "封存自訂欄位不能透過匯入修改。",
          "請先在網站恢復欄位，再下載新範本。",
          row.sourceRow,
        );
      continue;
    }
    try {
      const inputOptions = rows.map((option) => ({
        id: option.id || undefined,
        label: option.label,
        archived: option.status === "已封存",
      }));
      const input: FieldInput = {
        name: row.name,
        type: row.type as FieldType,
        options: inputOptions,
      };
      putField(snapshot, input, row.id || undefined);
      const next = snapshot.fields.find((field) =>
        previous ? field.id === previous.id : field.name === row.name.trim(),
      );
      if (!next) throw new Error("自訂欄位寫入後找不到資料。");
      const fieldChanges: MasterDataImportChange["fields"] = [];
      rowField(fieldChanges, "欄位名稱", previousValues?.name || "", next.name);
      rowField(fieldChanges, "欄位類型", previousValues?.type || "", next.type);
      change(
        changes,
        "自訂欄位",
        previous ? "更新" : "新增",
        next,
        fieldChanges,
      );
      for (const option of next.options) {
        const old = previousValues?.options.find(
          (item) => item.id === option.id,
        );
        if (
          !old ||
          old.label !== option.label ||
          old.archived !== option.archived
        )
          change(
            changes,
            "欄位選項",
            old ? "更新" : "新增",
            {
              id: option.id,
              code: "",
              name: option.label,
            },
            old
              ? [
                  {
                    name: "選項名稱",
                    before: old.label,
                    after: option.label,
                  },
                  ...(old.archived !== option.archived
                    ? [
                        {
                          name: "狀態",
                          before: old.archived ? "已封存" : "使用中",
                          after: option.archived ? "已封存" : "使用中",
                        },
                      ]
                    : []),
                ]
              : [{ name: "選項名稱", before: "", after: option.label }],
          );
      }
    } catch (error) {
      issue(
        issues,
        SHEETS.fields,
        "invalid-field",
        error instanceof Error ? error.message : "自訂欄位資料不正確。",
        "修正欄位名稱、類型或選項後重新檢查。",
        row.sourceRow,
      );
    }
  }

  const artworksByAlias = new Map<string, { id: string }>(
    [...artworkAliases].map(([alias]) => [
      alias,
      { id: createdArtworkIds.get(alias) || "" },
    ]),
  );
  const tagsByAlias = new Map<string, { id: string }>(
    [...tagAliases].map(([alias]) => [
      alias,
      { id: createdTagIds.get(alias) || "" },
    ]),
  );
  for (const row of document.products) {
    const rowIssueCount = issues.length;
    const previous = row.id
      ? snapshot.products.find((product) => product.id === row.id)
      : undefined;
    const previousValues = previous ? structuredClone(previous) : undefined;
    const ownerId = resolveReference(
      row.ownerId,
      [...partyRefs.values()],
      partiesByAlias,
      SHEETS.products,
      row.sourceRow,
      "商品擁有者ID",
      issues,
    );
    const creatorId = resolveReference(
      row.creatorId,
      [...partyRefs.values()],
      partiesByAlias,
      SHEETS.products,
      row.sourceRow,
      "創作者ID",
      issues,
    );
    const projectId = resolveReference(
      row.projectId,
      [...projectRefs.values()],
      projectsByAlias,
      SHEETS.products,
      row.sourceRow,
      "企劃ID",
      issues,
    );
    const tagIds = separated(row.tagIds).map((reference) =>
      resolveReference(
        reference,
        [...snapshot.tags],
        tagsByAlias,
        SHEETS.products,
        row.sourceRow,
        "標記ID（以、分隔）",
        issues,
      ),
    );
    if (new Set(tagIds).size !== tagIds.length)
      issue(
        issues,
        SHEETS.products,
        "duplicate-tag",
        "標記ID不可重複。",
        "每個標記只保留一次。",
        row.sourceRow,
        "標記ID（以、分隔）",
      );
    const artworkId = resolveReference(
      row.artworkId,
      [...snapshot.artworks],
      artworksByAlias,
      SHEETS.products,
      row.sourceRow,
      "柄圖ID",
      issues,
    );
    if (issues.length > rowIssueCount) continue;

    const normalized = {
      name: row.name.trim(),
      ownerId,
      creatorId,
      projectId,
      productType: row.productType.trim(),
      specification: row.specification.trim(),
      artwork: row.artwork.trim(),
      artworkId,
      notes: row.notes.trim(),
      tagIds,
    };
    const type = snapshot.productTypes.find(
      (item) => item.name === normalized.productType,
    );
    const artwork = normalized.artworkId
      ? snapshot.artworks.find((item) => item.id === normalized.artworkId)?.name
      : normalized.artwork;
    const unchanged =
      previous &&
      previous.name === normalized.name &&
      previous.ownerId === normalized.ownerId &&
      previous.creatorId === normalized.creatorId &&
      previous.projectId === normalized.projectId &&
      previous.typeId === (type?.id || "") &&
      previous.specification === normalized.specification &&
      previous.artwork === artwork &&
      (previous.artworkId || "") === normalized.artworkId &&
      previous.notes === normalized.notes &&
      JSON.stringify([...previous.tagIds].sort()) ===
        JSON.stringify([...tagIds].sort());
    if (unchanged) continue;
    try {
      const artworkIdsBefore = new Set(
        snapshot.artworks.map((artwork) => artwork.id),
      );
      const next = putProduct(
        snapshot,
        {
          name: normalized.name,
          ownerId: normalized.ownerId,
          creatorId: normalized.creatorId || undefined,
          projectId: normalized.projectId || undefined,
          productType: normalized.productType,
          specification: normalized.specification,
          artwork: normalized.artwork,
          artworkId: normalized.artworkId || undefined,
          notes: normalized.notes,
          tagIds,
          customValues: {},
        },
        row.id || undefined,
      );
      {
        const fields: MasterDataImportChange["fields"] = [];
        const partyName = (id: string) =>
          snapshot.parties.find((party) => party.id === id)?.name || id;
        const projectName = (id: string) =>
          snapshot.projects.find((project) => project.id === id)?.name || id;
        const tagNames = (ids: string[]) =>
          ids
            .map((id) => snapshot.tags.find((tag) => tag.id === id)?.name || id)
            .sort();
        rowField(fields, "商品名稱", previousValues?.name || "", next.name);
        rowField(
          fields,
          "商品擁有者",
          previousValues?.ownerId ? partyName(previousValues.ownerId) : "",
          next.ownerId ? partyName(next.ownerId) : "",
        );
        rowField(
          fields,
          "創作者",
          previousValues?.creatorId ? partyName(previousValues.creatorId) : "",
          next.creatorId ? partyName(next.creatorId) : "",
        );
        rowField(
          fields,
          "企劃",
          previousValues?.projectId
            ? projectName(previousValues.projectId)
            : "",
          next.projectId ? projectName(next.projectId) : "",
        );
        rowField(
          fields,
          "周邊種類",
          snapshot.productTypes.find(
            (item) => item.id === previousValues?.typeId,
          )?.name,
          snapshot.productTypes.find((item) => item.id === next.typeId)?.name,
        );
        rowField(
          fields,
          "規格",
          previousValues?.specification,
          next.specification,
        );
        rowField(fields, "柄圖名稱", previousValues?.artwork, next.artwork);
        rowField(
          fields,
          "柄圖ID",
          previousValues?.artworkId || "",
          next.artworkId || "",
        );
        rowField(fields, "備註", previousValues?.notes, next.notes);
        rowField(
          fields,
          "標記ID",
          tagNames(previousValues?.tagIds || []),
          tagNames(next.tagIds),
        );
        change(changes, "商品", previous ? "更新" : "新增", next, fields);
        for (const artwork of snapshot.artworks)
          if (!artworkIdsBefore.has(artwork.id))
            change(changes, "柄圖", "新增", artwork, [
              {
                name: "所屬企劃",
                before: "",
                after:
                  snapshot.projects.find(
                    (project) => project.id === artwork.projectId,
                  )?.name || "",
              },
              { name: "柄圖名稱", before: "", after: artwork.name },
            ]);
      }
    } catch (error) {
      issue(
        issues,
        SHEETS.products,
        "invalid-product",
        error instanceof Error ? error.message : "商品資料不正確。",
        "修正商品欄位或參照後重新檢查。",
        row.sourceRow,
      );
    }
  }

  const protectedAfter = JSON.stringify(
    Object.fromEntries(
      Object.entries(snapshot).filter(([key]) => !allowedChanges.has(key)),
    ),
  );
  if (protectedAfter !== protectedBefore)
    issue(
      issues,
      "03_商品",
      "history-changed",
      "匯入流程意外變更了歷史交易或財務資料，已拒絕此次匯入。",
      "保留目前資料並回報此錯誤，不要重複提交。",
    );

  if (!issues.length) {
    try {
      validateRestoreSnapshot(snapshot);
    } catch (error) {
      issue(
        issues,
        "03_商品",
        "snapshot-invalid",
        error instanceof Error ? error.message : "匯入後資料驗證失敗。",
        "修正參照或欄位內容後重新檢查。",
      );
    }
  }
  return { changes, issues };
}

export function previewMasterDataImport(
  snapshot: CatalogSnapshot,
  document: MasterDataImportDocument,
): MasterDataImportPreview {
  return applyDocument(structuredClone(snapshot), document);
}

export async function masterDataImportTemplateBytes(
  snapshot: CatalogSnapshot,
): Promise<ArrayBuffer> {
  const source: MasterDataImportSource = {
    workspaceId: snapshot.workspaceId,
    revision: snapshot.revision,
    parties: snapshot.parties,
    projects: snapshot.projects,
    events: snapshot.events,
    projectEvents: snapshot.projectEvents,
    products: snapshot.products,
    productTypes: snapshot.productTypes,
    tags: snapshot.tags,
    artworks: snapshot.artworks,
    fields: snapshot.fields,
  };
  return callWorker<ArrayBuffer>(
    { type: "template", snapshot: source },
    "產生主資料匯入範本失敗。",
  );
}

export async function parseMasterDataImportFile(file: File): Promise<{
  document: MasterDataImportDocument | null;
  issues: MasterDataImportIssue[];
}> {
  if (!file.name.toLowerCase().endsWith(".xlsx"))
    throw new Error("請選擇 .xlsx 主資料匯入檔。");
  if (file.size > 10 * 1024 * 1024)
    throw new Error("目前支援最大 10 MB 的 XLSX 檔案。");
  const bytes = await file.arrayBuffer();
  return callWorker({ type: "parse", bytes }, "檢查主資料匯入檔失敗。", [
    bytes,
  ]);
}

async function callWorker<T>(
  message:
    | { type: "template"; snapshot: MasterDataImportSource }
    | { type: "parse"; bytes: ArrayBuffer },
  fallback: string,
  transfer: Transferable[] = [],
): Promise<T> {
  const worker = new Worker(
    new URL("../workers/project-restore.worker.ts", import.meta.url),
    { type: "module" },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("處理超過 30 秒，請確認檔案大小後重試。")),
        30000,
      );
      worker.onmessage = (event) =>
        event.data.ok
          ? resolve(event.data.result as T)
          : reject(new Error(event.data.error || fallback));
      worker.onerror = () => reject(new Error(fallback));
      worker.postMessage(message, transfer);
    });
  } finally {
    if (timer) clearTimeout(timer);
    worker.terminate();
  }
}

export async function commitMasterDataImport(
  document: MasterDataImportDocument,
) {
  return catalogRepository.change(
    document.workspaceId,
    document.baseRevision,
    (snapshot) => {
      const result = applyDocument(snapshot, document);
      if (result.issues.length)
        throw new Error(result.issues.map((item) => item.message).join("\n"));
      if (!result.changes.length)
        throw new Error("沒有資料變更，工作區未更新。");
    },
  );
}
