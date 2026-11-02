import type {
  CatalogSnapshot,
  CatalogItem,
  FieldInput,
  ProductInput,
  CustomValue,
  NamedRecord,
} from "../models/catalog";
export const SUGGESTED_TAGS = [
  "新商品",
  "限定販售",
  "清倉",
  "再販",
  "預購",
  "親簽",
] as const;
export function text(value: string, label: string, max = 80): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw new Error(`${label}請填寫 1 至 ${max} 個字。`);
  return value.trim();
}
export function record(
  s: CatalogSnapshot,
  kind: string,
  name: string,
): NamedRecord {
  s.counters[kind] = (s.counters[kind] || 0) + 1;
  return {
    id: crypto.randomUUID(),
    workspaceId: s.workspaceId,
    code: `${kind}-${String(s.counters[kind]).padStart(6, "0")}`,
    name,
  };
}
function named(
  s: CatalogSnapshot,
  key: "parties" | "projects" | "productTypes",
  kind: string,
  id: string | undefined,
  name: string | undefined,
): string {
  if (id) {
    const found = s[key].find((r) => r.id === id);
    if (!found) throw new Error("找不到這個工作區的關聯資料，請重新選擇。");
    return found.id;
  }
  const clean = text(
    name || "",
    key === "parties"
      ? "創作者名稱"
      : key === "projects"
        ? "企劃名稱"
        : "周邊種類",
  );
  // Reuse only exact names explicitly entered in this starter catalog, never fuzzy matching.
  const matches = s[key].filter((r) => r.name === clean);
  if (matches.length > 1) throw new Error("有同名資料，請從既有清單選擇。");
  if (matches[0]) return matches[0].id;
  const created = record(s, kind, clean);
  s[key].push(created);
  return created.id;
}
export function putTag(s: CatalogSnapshot, name: string, id?: string) {
  const clean = text(name, "標記名稱", 40);
  if (s.tags.some((t) => t.name === clean && t.id !== id))
    throw new Error("已有同名標記，請使用或重新啟用原標記。");
  if (id) {
    const tag = s.tags.find((t) => t.id === id);
    if (!tag) throw new Error("找不到標記。");
    tag.name = clean;
    tag.archived = false;
  } else s.tags.push({ ...record(s, "TAG", clean), archived: false });
}
export function putField(s: CatalogSnapshot, input: FieldInput, id?: string) {
  const name = text(input.name, "欄位名稱", 40);
  const previous = id ? s.fields.find((f) => f.id === id) : undefined;
  if (id && !previous) throw new Error("找不到欄位。");
  if (
    !["text", "number", "single", "multi", "boolean", "date"].includes(
      input.type,
    )
  )
    throw new Error("不支援這種欄位類型。");
  if (previous && previous.type !== input.type)
    throw new Error("既有欄位不能直接變更類型；請另建欄位，保留舊資料。");
  if (s.fields.some((f) => f.name === name && f.id !== id))
    throw new Error("已有同名欄位，請使用其他名稱。");
  const options = input.options.map((o) => {
    if (o.id && !previous?.options.some((old) => old.id === o.id))
      throw new Error("選項不屬於這個欄位。");
    return {
      id: o.id || crypto.randomUUID(),
      label: text(o.label, "選項名稱", 60),
      archived: !!o.archived,
    };
  });
  if (new Set(options.map((o) => o.id)).size !== options.length)
    throw new Error("選項重複。");
  if (
    new Set(options.filter((o) => !o.archived).map((o) => o.label)).size !==
    options.filter((o) => !o.archived).length
  )
    throw new Error("使用中的選項名稱不能重複。");
  for (const old of previous?.options || [])
    if (!options.some((o) => o.id === old.id))
      options.push({ ...old, archived: true });
  const choice = input.type === "single" || input.type === "multi";
  if (choice && !options.some((o) => !o.archived))
    throw new Error("單選或多選欄位至少需要一個使用中的選項。");
  if (!choice && options.length) throw new Error("這種欄位不需要選項。");
  if (previous) Object.assign(previous, { name, options, archived: false });
  else
    s.fields.push({
      ...record(s, "FLD", name),
      type: input.type,
      options,
      archived: false,
    });
}
function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}
export function putProduct(
  s: CatalogSnapshot,
  input: ProductInput,
  id?: string,
): CatalogItem {
  const old = id ? s.products.find((p) => p.id === id) : undefined;
  if (id && !old) throw new Error("找不到商品。");
  const name = text(input.name, "商品名稱");
  const creatorId =
    input.creatorId || input.creatorName?.trim()
      ? named(s, "parties", "PTY", input.creatorId, input.creatorName)
      : "";
  const projectId =
    input.projectId || input.projectName?.trim()
      ? named(s, "projects", "PRJ", input.projectId, input.projectName)
      : "";
  const typeId = input.productType.trim()
    ? named(s, "productTypes", "TYP", undefined, input.productType)
    : "";

  const specification = input.specification.trim();
  if (
    specification.length > 120 ||
    input.artwork.length > 120 ||
    input.notes.length > 2000
  )
    throw new Error("規格／柄圖最多120字，備註最多2000字。");
  let spec = s.specs.find(
    (r) => r.typeId === typeId && r.name === (specification || "未指定規格"),
  );
  if (!spec) {
    spec = { ...record(s, "SPC", specification || "未指定規格"), typeId };
    s.specs.push(spec);
  }
  let series =
    old &&
    s.series.find(
      (r) =>
        r.id === old.seriesId &&
        r.typeId === typeId &&
        r.projectId === projectId,
    );
  if (!series) {
    series = { ...record(s, "PRD", `${name}系列`), projectId, typeId };
    s.series.push(series);
  }
  let artworkId: string | undefined;
  if (input.artwork.trim()) {
    let art = s.artworks.find(
      (r) => r.name === input.artwork.trim() && r.projectId === projectId,
    );
    if (!art) {
      art = { ...record(s, "ART", input.artwork.trim()), projectId };
      s.artworks.push(art);
    }
    artworkId = art.id;
  }
  const tagIds = [...new Set(input.tagIds)];
  for (const tagId of tagIds) {
    const tag = s.tags.find((t) => t.id === tagId);
    if (!tag || (tag.archived && !old?.tagIds.includes(tagId)))
      throw new Error("標記不屬於目前工作區或已封存。");
  }
  const values: Record<string, CustomValue> = {
    ...(old?.customValues || {}),
    ...input.customValues,
  };
  for (const [fieldId, value] of Object.entries(values)) {
    const field = s.fields.find((f) => f.id === fieldId);
    if (!field) throw new Error("自訂欄位不屬於目前工作區。");
    if (field.archived && !same(value, old?.customValues[fieldId]))
      throw new Error("已封存欄位只能保留原值。");
    if (value === null || value === "") continue;
    if (
      field.type === "text" &&
      (typeof value !== "string" || value.length > 2000)
    )
      throw new Error(`${field.name}請填文字，最多2000字。`);
    if (
      field.type === "number" &&
      (typeof value !== "number" ||
        !Number.isFinite(value) ||
        Math.abs(value) > Number.MAX_SAFE_INTEGER)
    )
      throw new Error(`${field.name}請填有效數字。`);
    if (field.type === "boolean" && typeof value !== "boolean")
      throw new Error(`${field.name}請選是或否。`);
    if (
      field.type === "date" &&
      (typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number.isNaN(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      throw new Error(`${field.name}請填有效日期。`);
    if (field.type === "single" || field.type === "multi") {
      if (field.type === "single" && typeof value !== "string")
        throw new Error(`${field.name}請選一個選項。`);
      if (
        field.type === "multi" &&
        (!Array.isArray(value) ||
          value.some((v) => typeof v !== "string") ||
          new Set(value).size !== value.length)
      )
        throw new Error(`${field.name}請選不重複的選項。`);
      const selected = Array.isArray(value) ? value : [value];
      const prior = old?.customValues[fieldId];
      for (const optionId of selected) {
        const option = field.options.find((o) => o.id === optionId);
        const already = Array.isArray(prior)
          ? prior.includes(String(optionId))
          : prior === optionId;
        if (!option || (option.archived && !already))
          throw new Error(`${field.name}含已停用或不存在的選項。`);
      }
    }
  }
  const now = new Date().toISOString();
  const item: CatalogItem = {
    ...(old || record(s, "SKU", name)),
    name,
    creatorId,
    projectId,
    typeId,
    seriesId: series.id,
    specId: spec.id,
    specification,
    artwork: input.artwork.trim(),
    artworkId,
    notes: input.notes.trim(),
    tagIds,
    customValues: values,
    archived: old?.archived ?? false,
    createdAt: old?.createdAt || now,
    updatedAt: now,
  };
  if (old) Object.assign(old, item);
  else s.products.push(item);
  return item;
}
