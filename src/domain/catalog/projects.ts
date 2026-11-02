import type {
  CatalogSnapshot,
  ProjectInput,
  EventInput,
} from "../models/catalog";
import { record, text } from "./operations";
function notes(value: string, label: string, max = 2000) {
  if (typeof value !== "string" || value.length > max)
    throw new Error(`${label}最多${max}字。`);
  return value.trim();
}
function date(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new Error("請填寫有效日期（YYYY-MM-DD）。");
  return value;
}
export function putProject(
  s: CatalogSnapshot,
  input: ProjectInput,
  id?: string,
) {
  const name = text(input.name, "企劃名稱"),
    description = notes(input.description, "企劃說明");
  const previous = id ? s.projects.find((p) => p.id === id) : undefined;
  if (id && !previous) throw new Error("找不到目前工作區的企劃。");
  if (previous) {
    previous.name = name;
    previous.description = description;
    return previous;
  }
  const project = { ...record(s, "PRJ", name), description, archived: false };
  s.projects.push(project);
  return project;
}
export function toggleProjectArchive(s: CatalogSnapshot, id: string) {
  const project = s.projects.find((p) => p.id === id);
  if (!project) throw new Error("找不到目前工作區的企劃。");
  project.archived = !project.archived;
}
export function putEvent(s: CatalogSnapshot, input: EventInput, id?: string) {
  const name = text(input.name, "場次名稱"),
    startDate = date(input.startDate),
    endDate = date(input.endDate || startDate);
  if (endDate < startDate) throw new Error("結束日期不能早於開始日期。");
  const venue = notes(input.venue, "地點", 200),
    eventNotes = notes(input.notes, "場次備註");
  const previous = id ? s.events.find((e) => e.id === id) : undefined;
  if (id && !previous) throw new Error("找不到目前工作區的場次。");
  if (
    !Array.isArray(input.projectIds) ||
    input.projectIds.some((id) => typeof id !== "string")
  )
    throw new Error("請選擇有效企劃。");
  const projectIds = [...new Set(input.projectIds)];
  for (const projectId of projectIds) {
    const p = s.projects.find((p) => p.id === projectId);
    if (!p) throw new Error("企劃不屬於目前工作區。");
    const linked =
      previous &&
      s.projectEvents.some(
        (r) => r.projectId === projectId && r.eventId === previous.id,
      );
    if (p.archived && !linked)
      throw new Error("不能新增已封存企劃的參場關聯，請先恢復企劃。");
  }
  const event = previous || {
    ...record(s, "EVT", name),
    name,
    startDate,
    endDate,
    venue,
    notes: eventNotes,
    archived: false,
  };
  Object.assign(event, { name, startDate, endDate, venue, notes: eventNotes });
  if (!previous) s.events.push(event);
  s.projectEvents = s.projectEvents.filter(
    (link) => link.eventId !== event.id || projectIds.includes(link.projectId),
  );
  for (const projectId of projectIds)
    if (
      !s.projectEvents.some(
        (r) => r.projectId === projectId && r.eventId === event.id,
      )
    )
      s.projectEvents.push({
        ...record(s, "PEV", `${event.name}參場`),
        projectId,
        eventId: event.id,
      });
  return event;
}
export function toggleEventArchive(s: CatalogSnapshot, id: string) {
  const event = s.events.find((e) => e.id === id);
  if (!event) throw new Error("找不到目前工作區的場次。");
  event.archived = !event.archived;
}
