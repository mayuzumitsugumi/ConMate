import { describe, expect, it } from "vitest";
import {
  putEvent,
  putProject,
  toggleEventArchive,
  toggleProjectArchive,
} from "../../src/domain/catalog/projects";
import { putProduct } from "../../src/domain/catalog/operations";
import type { CatalogSnapshot } from "../../src/domain/models/catalog";
import type { Workspace } from "../../src/domain/models/workspace";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";

function snapshot(name: string): CatalogSnapshot {
  const workspace: Workspace = {
    id: crypto.randomUUID(),
    name,
    currency: "TWD",
    timezone: "Asia/Taipei",
    createdAt: new Date().toISOString(),
  };
  return emptyCatalog(workspace);
}

function eventInput(
  overrides: Partial<{
    name: string;
    startDate: string;
    endDate: string;
    venue: string;
    notes: string;
    projectIds: string[];
  }> = {},
) {
  return {
    name: "星港創作市集",
    startDate: "2026-11-02",
    endDate: "2026-11-03",
    venue: "台北",
    notes: "",
    projectIds: [] as string[],
    ...overrides,
  };
}

describe("project and event operations", () => {
  it("requires project and event names", () => {
    const s = snapshot("名稱驗證");

    expect(() => putProject(s, { name: "  ", description: "" })).toThrow(
      "企劃名稱請填寫",
    );
    expect(() => putEvent(s, eventInput({ name: "" }))).toThrow(
      "場次名稱請填寫",
    );
  });

  it("validates event dates and defaults a missing end date to the start", () => {
    const s = snapshot("日期驗證");
    const singleDay = putEvent(
      s,
      eventInput({ startDate: "2026-02-28", endDate: "" }),
    );

    expect(singleDay.endDate).toBe("2026-02-28");
    expect(() => putEvent(s, eventInput({ startDate: "2026-02-30" }))).toThrow(
      "請填寫有效日期",
    );
    expect(() =>
      putEvent(
        s,
        eventInput({ startDate: "2026-11-04", endDate: "2026-11-03" }),
      ),
    ).toThrow("結束日期不能早於開始日期");
  });

  it("supports many projects across many events and deduplicates each event selection", () => {
    const s = snapshot("多企劃多場");
    const firstProject = putProject(s, {
      name: "星夜企劃",
      description: "徽章與吊飾",
    });
    const secondProject = putProject(s, {
      name: "海風企劃",
      description: "明信片",
    });
    const firstEvent = putEvent(
      s,
      eventInput({
        projectIds: [firstProject.id, firstProject.id, secondProject.id],
      }),
    );
    const secondEvent = putEvent(
      s,
      eventInput({
        name: "河岸市集",
        startDate: "2026-12-01",
        endDate: "2026-12-01",
        projectIds: [secondProject.id],
      }),
    );

    expect(
      s.projectEvents
        .filter((link) => link.eventId === firstEvent.id)
        .map((link) => link.projectId)
        .sort(),
    ).toEqual([firstProject.id, secondProject.id].sort());
    expect(
      s.projectEvents
        .filter((link) => link.eventId === secondEvent.id)
        .map((link) => link.projectId),
    ).toEqual([secondProject.id]);
  });

  it("rejects project IDs owned by another workspace", () => {
    const first = snapshot("企劃所在工作區");
    const second = snapshot("場次所在工作區");
    const project = putProject(first, { name: "外部企劃", description: "" });

    expect(() =>
      putEvent(second, eventInput({ projectIds: [project.id] })),
    ).toThrow("企劃不屬於目前工作區");
  });

  it("keeps product project IDs stable when a project is renamed", () => {
    const s = snapshot("商品關聯");
    const project = putProject(s, { name: "舊企劃名", description: "原說明" });
    const product = putProduct(s, {
      name: "星狐徽章",
      projectId: project.id,
      productType: "徽章",
      specification: "58mm",
      artwork: "",
      notes: "",
      tagIds: [],
      customValues: {},
    });

    putProject(s, { name: "新企劃名", description: "更新說明" }, project.id);

    expect(s.projects[0]).toMatchObject({
      id: project.id,
      name: "新企劃名",
      description: "更新說明",
    });
    expect(product.projectId).toBe(project.id);
  });

  it("preserves project and event links and data through archive and restore", () => {
    const s = snapshot("封存恢復");
    const project = putProject(s, {
      name: "星夜企劃",
      description: "保留說明",
    });
    const event = putEvent(s, eventInput({ projectIds: [project.id] }));
    const originalLink = { ...s.projectEvents[0] };

    toggleProjectArchive(s, project.id);
    toggleEventArchive(s, event.id);
    expect(project.archived).toBe(true);
    expect(event.archived).toBe(true);
    expect(s.projectEvents).toEqual([originalLink]);
    expect(project.description).toBe("保留說明");
    expect(event.name).toBe("星港創作市集");

    toggleProjectArchive(s, project.id);
    toggleEventArchive(s, event.id);
    expect(project.archived).toBe(false);
    expect(event.archived).toBe(false);
    expect(s.projectEvents).toEqual([originalLink]);
  });

  it("blocks new links to archived projects but keeps and can remove existing links", () => {
    const s = snapshot("封存企劃關聯");
    const project = putProject(s, { name: "已封存企劃", description: "" });
    const event = putEvent(s, eventInput({ projectIds: [project.id] }));
    toggleProjectArchive(s, project.id);

    expect(s.projectEvents).toHaveLength(1);
    expect(
      putEvent(
        s,
        eventInput({ name: "更新既有場次", projectIds: [project.id] }),
        event.id,
      ),
    ).toBe(event);
    expect(() =>
      putEvent(s, eventInput({ name: "新場次", projectIds: [project.id] })),
    ).toThrow("不能新增已封存企劃的參場關聯");

    putEvent(s, eventInput({ projectIds: [] }), event.id);
    expect(s.projectEvents).toEqual([]);
    expect(() =>
      putEvent(s, eventInput({ name: "再次新增", projectIds: [project.id] })),
    ).toThrow("不能新增已封存企劃的參場關聯");
  });

  it("rejects edits and archive toggles for IDs outside the snapshot", () => {
    const first = snapshot("ID來源");
    const second = snapshot("ID目的地");
    const project = putProject(first, { name: "企劃", description: "" });
    const event = putEvent(first, eventInput());

    expect(() =>
      putProject(second, { name: "修改", description: "" }, project.id),
    ).toThrow("找不到目前工作區的企劃");
    expect(() => toggleProjectArchive(second, project.id)).toThrow(
      "找不到目前工作區的企劃",
    );
    expect(() => putEvent(second, eventInput(), event.id)).toThrow(
      "找不到目前工作區的場次",
    );
    expect(() => toggleEventArchive(second, event.id)).toThrow(
      "找不到目前工作區的場次",
    );
  });
});
