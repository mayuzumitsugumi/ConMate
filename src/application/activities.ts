import { database } from "../infrastructure/storage/workspaces";
import { catalogRepository } from "../infrastructure/storage/catalog";
import { validateRestoreSnapshot } from "../domain/validation/restore";
import {
  prepareHandoff,
  validateActivityPacket,
  applyActivityCommand,
  closeActivityPacket,
  previewActivityMerge as domainPreview,
  mergeActivityPacket,
  returnActivityStock as domainReturn,
} from "../domain/activity/operations";
import type {
  ActivityPacket,
  ActivityCommand,
  HandoffInput,
} from "../domain/activity/types";
import { checkActivityFile, downloadActivityPacket } from "./activity-file";
export const inspectActivityFile = checkActivityFile;
export async function packetFingerprint(packet: ActivityPacket) {
  const bytes = new TextEncoder().encode(JSON.stringify(packet));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function listActivities(): Promise<ActivityPacket[]> {
  const packets = new Map(
    (await database.activityPackets.toArray()).map((p) => [p.handoffId, p]),
  );
  for (const s of await database.catalogs.toArray())
    for (const h of s.activityHandoffs)
      packets.set(h.id, h.localPacket || h.packet);
  return [...packets.values()];
}
export async function readActivity(id: string) {
  const p = (await listActivities()).find((p) => p.handoffId === id);
  if (!p) throw new Error("找不到活動交接檔。");
  return validateActivityPacket(structuredClone(p));
}
const tables = () => [
  database.workspaces,
  database.catalogs,
  database.activityPackets,
  database.recoverySnapshots,
];
function nextRevision(n: number) {
  if (!Number.isSafeInteger(n + 1))
    throw new Error("修訂超出安全範圍，請保留備份。");
  return n + 1;
}
async function persistPacket(packet: ActivityPacket) {
  const parent = await database.catalogs.get(packet.sourceWorkspaceId),
    h = parent?.activityHandoffs.find((h) => h.id === packet.handoffId);
  if (parent && h) {
    if (parent.activityMerges.some((m) => m.handoffId === h.id))
      throw new Error("活動已合回，請由創作管理另建更正紀錄。");
    h.localPacket = packet;
    parent.revision = nextRevision(parent.revision);
    validateRestoreSnapshot(parent);
    await database.catalogs.put(parent);
  }
  await database.activityPackets.put(packet);
}
export async function createHandoff(
  workspaceId: string,
  expectedRevision: number,
  input: HandoffInput,
) {
  return database.transaction("rw", tables(), async () => {
    const s = await catalogRepository.read(workspaceId);
    if (s.revision !== expectedRevision)
      throw new Error("工作區已更新，請重新載入後交付。");
    const { record, packet } = prepareHandoff(s, input);
    if (!s.activityHandoffs.some((h) => h.id === record.id))
      s.activityHandoffs.push(record);
    s.revision = nextRevision(s.revision);
    validateRestoreSnapshot(s);
    await database.catalogs.put(s);
    await database.activityPackets.add(packet);
    return packet;
  });
}
export async function previewActivityImport(input: ActivityPacket) {
  const packet = validateActivityPacket(structuredClone(input)),
    existing =
      (await listActivities()).find((p) => p.handoffId === packet.handoffId) ||
      null;
  let canImport = true,
    reason = "可匯入此活動交接檔。";
  if (existing) {
    const normalized = validateActivityPacket(existing);
    const immutable = [
      "sourceWorkspaceId",
      "sourceRevision",
      "eventId",
      "name",
      "createdAt",
      "locationId",
      "sources",
      "baseline",
      "financialReferences",
    ] as const;
    if (
      immutable.some(
        (k) => JSON.stringify(normalized[k]) !== JSON.stringify(packet[k]),
      )
    )
      return {
        existing,
        canImport: false,
        reason: "交接來源或原始快照已變更，不能取代原活動。",
      };
    if (JSON.stringify(normalized) === JSON.stringify(packet))
      reason = "內容與本機相同，不會重複新增。";
    else if (existing.closure) {
      canImport = false;
      reason = "本機活動已結案，不能取代；請由創作管理更正。";
    } else if (
      packet.revision <= existing.revision ||
      (!packet.lineage.includes(await packetFingerprint(existing)) &&
        !packet.lineage.includes(await packetFingerprint(normalized)))
    ) {
      canImport = false;
      reason = "本機與檔案已分歧，不能依較大修訂覆蓋。請確認最後接手的檔案。";
    }
  }
  return { existing, canImport, reason };
}
export async function saveImportedActivity(
  input: ActivityPacket,
  expectedLocalRevision?: number,
) {
  const packet = validateActivityPacket(structuredClone(input)),
    before = await previewActivityImport(packet);
  if (!before.canImport) throw new Error(before.reason);
  if (
    expectedLocalRevision !== undefined &&
    before.existing?.revision !== expectedLocalRevision
  )
    throw new Error("本機活動已改變，請重新預覽。");
  const expected = before.existing ? JSON.stringify(before.existing) : null;
  return database.transaction("rw", tables(), async () => {
    const current =
      (await listActivities()).find((p) => p.handoffId === packet.handoffId) ||
      null;
    if ((current ? JSON.stringify(current) : null) !== expected)
      throw new Error("預覽後活動已有變更，原資料未覆蓋。");
    if (
      current &&
      JSON.stringify(validateActivityPacket(current)) === JSON.stringify(packet)
    )
      return validateActivityPacket(current);
    await persistPacket(packet);
    return packet;
  });
}
export async function changeActivity(
  id: string,
  expectedRevision: number,
  command: ActivityCommand,
) {
  const before = await readActivity(id),
    fingerprint = await packetFingerprint(before);
  if (before.revision !== expectedRevision)
    throw new Error("活動已更新，請重新載入。");
  return database.transaction("rw", tables(), async () => {
    const current = await readActivity(id);
    if (JSON.stringify(current) !== JSON.stringify(before))
      throw new Error("活動已更新，請重新載入。");
    const next = applyActivityCommand(current, command);
    next.lineage = [...current.lineage, fingerprint];
    validateActivityPacket(next);
    await persistPacket(next);
    return next;
  });
}
export async function closeActivity(
  id: string,
  expectedRevision: number,
  counts: { productId: string; actual: number; reason: string }[],
  notes: string,
) {
  const before = await readActivity(id),
    fingerprint = await packetFingerprint(before);
  if (before.revision !== expectedRevision)
    throw new Error("活動已更新，請重新載入。");
  return database.transaction("rw", tables(), async () => {
    const current = await readActivity(id);
    if (JSON.stringify(current) !== JSON.stringify(before))
      throw new Error("活動已更新，請重新載入。");
    const next = closeActivityPacket(current, counts, notes);
    next.lineage = [...current.lineage, fingerprint];
    validateActivityPacket(next);
    await persistPacket(next);
    return next;
  });
}
export async function exportActivity(id: string) {
  await downloadActivityPacket(await readActivity(id));
}
export async function previewActivityMerge(
  workspaceId: string,
  packetId: string,
) {
  const s = await catalogRepository.read(workspaceId);
  return {
    ...domainPreview(s, await readActivity(packetId)),
    expectedRevision: s.revision,
  };
}
export async function mergeActivity(
  workspaceId: string,
  expectedRevision: number,
  packetId: string,
  mappings: Record<string, string>,
) {
  return database.transaction("rw", tables(), async () => {
    const s = await catalogRepository.read(workspaceId);
    if (s.revision !== expectedRevision)
      throw new Error("工作區已更新，請重新預覽合回。");
    const old = structuredClone(s),
      before = s.activityMerges.length,
      result = mergeActivityPacket(s, await readActivity(packetId), mappings);
    if (before === s.activityMerges.length) return result;
    s.revision = nextRevision(s.revision);
    validateRestoreSnapshot(s);
    await database.recoverySnapshots.add({
      id: crypto.randomUUID(),
      workspaceId,
      createdAt: new Date().toISOString(),
      source: "file",
      restoredFromRevision: old.revision,
      restoredToRevision: s.revision,
      snapshot: old,
    });
    await database.catalogs.put(s);
    return result;
  });
}
export async function returnActivityStock(
  workspaceId: string,
  expectedRevision: number,
  handoffId: string,
  toLocationId: string,
  reason: string,
) {
  return database.transaction("rw", tables(), async () => {
    const s = await catalogRepository.read(workspaceId);
    if (s.revision !== expectedRevision)
      throw new Error("工作區已更新，請重新載入。");
    const result = domainReturn(s, handoffId, toLocationId, reason);
    s.revision = nextRevision(s.revision);
    validateRestoreSnapshot(s);
    await database.catalogs.put(s);
    return result;
  });
}
