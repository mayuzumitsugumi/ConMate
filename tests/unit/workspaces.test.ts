import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConMateDatabase,
  workspaceRepository,
} from "../../src/infrastructure/storage/workspaces";

const db = new ConMateDatabase();
afterEach(async () => {
  await db.workspaces.clear();
});
describe("local workspaces", () => {
  it("persists names and stable IDs across a new database connection", async () => {
    const result = await workspaceRepository.create("  我的工作室  ");
    expect(result.name).toBe("我的工作室");
    expect(result.id).toMatch(/^[a-f0-9-]{36}$/);
    const second = new ConMateDatabase();
    expect(await second.workspaces.get(result.id)).toEqual(result);
    second.close();
  });
  it("rejects empty and overlong names without writing", async () => {
    await expect(workspaceRepository.create("   ")).rejects.toThrow("1 至 80");
    await expect(workspaceRepository.create("字".repeat(81))).rejects.toThrow(
      "1 至 80",
    );
    expect(await db.workspaces.count()).toBe(0);
  });
});
