import type {
  CatalogSnapshot,
  PartyInput,
  ArtworkInput,
} from "../models/catalog";
import { record, text } from "./operations";
export function upgradeMasterData(s: any) {
  s.parties = s.parties.map((p: any) => ({ ...p, notes: "", archived: false }));
  s.artworks = s.artworks.map((a: any) => ({
    ...a,
    authorIds: [],
    notes: "",
    archived: false,
  }));
  s.products = s.products.map((p: any) => ({ ...p, ownerId: "" }));
  s.schemaVersion = 14;
  return s;
}
function notes(v: string) {
  if (
    typeof v !== "string" ||
    v.length > 2000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)
  )
    throw new Error("備註最多2000字，不能含控制字元。");
  return v.trim();
}
export function putParty(s: CatalogSnapshot, input: PartyInput, id?: string) {
  const name = text(input.name, "參與方名稱"),
    note = notes(input.notes);
  const old = id ? s.parties.find((p) => p.id === id) : undefined;
  if (id && !old) throw new Error("找不到參與方。");
  if (s.parties.some((p) => p.name === name && p.id !== id))
    throw new Error("已有同名參與方，請使用或恢復原資料。");
  if (old) {
    old.name = name;
    old.notes = note;
    return old;
  }
  const p = { ...record(s, "PTY", name), notes: note, archived: false };
  s.parties.push(p);
  return p;
}
export function putArtwork(
  s: CatalogSnapshot,
  input: ArtworkInput,
  id?: string,
) {
  const name = text(input.name, "柄圖名稱", 120),
    note = notes(input.notes);
  const old = id ? s.artworks.find((a) => a.id === id) : undefined;
  if (id && !old) throw new Error("找不到柄圖。");
  const project = s.projects.find((p) => p.id === input.projectId);
  if (
    input.projectId &&
    (!project || (project.archived && old?.projectId !== project.id))
  )
    throw new Error("請選擇使用中的企劃。");
  if (
    old &&
    old.projectId !== input.projectId &&
    s.products.some((p) => p.artworkId === id)
  )
    throw new Error("已有商品使用此柄圖，不能直接變更企劃；請另建柄圖。");
  if (
    !Array.isArray(input.authorIds) ||
    new Set(input.authorIds).size !== input.authorIds.length
  )
    throw new Error("作者不能重複。");
  for (const aid of input.authorIds) {
    const p = s.parties.find((p) => p.id === aid);
    if (!p || (p.archived && !old?.authorIds.includes(aid)))
      throw new Error("請選擇使用中的柄圖作者。");
  }
  if (
    s.artworks.some(
      (a) => a.id !== id && a.name === name && a.projectId === input.projectId,
    )
  )
    throw new Error("同企劃已有同名柄圖。");
  if (old) {
    Object.assign(old, {
      name,
      projectId: input.projectId,
      authorIds: [...input.authorIds],
      notes: note,
    });
    return old;
  }
  const a = {
    ...record(s, "ART", name),
    projectId: input.projectId,
    authorIds: [...input.authorIds],
    notes: note,
    archived: false,
  };
  s.artworks.push(a);
  return a;
}
export function togglePartyArchive(s: CatalogSnapshot, id: string) {
  const p = s.parties.find((p) => p.id === id);
  if (!p) throw new Error("找不到參與方。");
  p.archived = !p.archived;
}
export function toggleArtworkArchive(s: CatalogSnapshot, id: string) {
  const a = s.artworks.find((a) => a.id === id);
  if (!a) throw new Error("找不到柄圖。");
  a.archived = !a.archived;
}
