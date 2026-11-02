import { database } from "./workspaces";
import { validateRestoreSnapshot } from "../../domain/validation/restore";
export async function restoreWorkspace(input: unknown) {
  // Validate again at the storage boundary; add (not put) prevents overwrite even during competing restores.
  const snapshot = validateRestoreSnapshot(structuredClone(input));
  await database.transaction(
    "rw",
    database.workspaces,
    database.catalogs,
    async () => {
      if (
        (await database.workspaces.get(snapshot.workspaceId)) ||
        (await database.catalogs.get(snapshot.workspaceId))
      )
        throw new Error(
          "本機已有相同工作區。為保護既有資料，本版不會覆蓋或合併；可在另一台裝置或另一個瀏覽器還原。",
        );
      await database.workspaces.add(snapshot.workspace);
      await database.catalogs.add(snapshot);
    },
  );
  return snapshot.workspaceId;
}
