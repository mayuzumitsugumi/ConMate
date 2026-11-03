// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { GitHubBackupClient } from "../../src/infrastructure/cloud/github";
import { emptyCatalog } from "../../src/infrastructure/storage/catalog";
const token = "github_pat_" + "A".repeat(30),
  head = "a".repeat(40),
  blob = "b".repeat(40),
  commit = "c".repeat(40);
function fixture() {
  return emptyCatalog({
    id: crypto.randomUUID(),
    name: "測試工作區",
    createdAt: new Date().toISOString(),
    currency: "TWD",
    timezone: "Asia/Taipei",
  });
}
function setup() {
  let remote: ReturnType<typeof fixture> | null = null,
    currentHead = head,
    privateRepo = true,
    status = 0,
    onlyPut = false,
    rawMode = false,
    puts: any[] = [];
  const requests: { url: string; options: any }[] = [];
  const encode = async (s: any) =>
    new TextEncoder().encode(JSON.stringify(s)).buffer;
  const inspect = async (b: ArrayBuffer) =>
    JSON.parse(new TextDecoder().decode(b));
  const fetcher = vi.fn(async (url: any, options: any) => {
    requests.push({ url, options });
    if (status && (!onlyPut || options.method === "PUT"))
      return new Response(JSON.stringify({ message: token }), { status });
    let body: any;
    if (url.endsWith("/user")) body = { login: "tester" };
    else if (url.includes("/branches/"))
      body = { commit: { sha: currentHead } };
    else if (options.method === "PUT") {
      puts.push(JSON.parse(options.body));
      body = { commit: { sha: commit }, content: { sha: blob } };
    } else if (url.includes("/commits?"))
      body = [
        {
          sha: commit,
          commit: {
            message: "backup",
            committer: { date: "2026-11-03T00:00:00Z" },
          },
        },
      ];
    else if (url.includes("/contents/conmate/workspaces?"))
      body = remote ? [{ type: "dir", name: remote.workspaceId }] : [];
    else if (url.includes("/contents/")) {
      if (!remote) return new Response("{}", { status: 404 });
      const bytes = await encode(remote);
      if (options.headers.Accept.includes(".raw"))
        return new Response(bytes, { status: 200 });
      body = {
        type: "file",
        encoding: rawMode ? "none" : "base64",
        content: Buffer.from(bytes).toString("base64"),
        size: bytes.byteLength,
        sha: blob,
      };
    } else body = { private: privateRepo, permissions: { push: true } };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  const client = new GitHubBackupClient(token, {
    fetch: fetcher,
    encode,
    inspect,
  });
  return {
    client,
    requests,
    puts,
    remote: (s: any) => {
      remote = s;
    },
    head: (v: string) => {
      currentHead = v;
    },
    private: (v: boolean) => {
      privateRepo = v;
    },
    status: (v: number, putOnly = false) => {
      status = v;
      onlyPut = putOnly;
    },
    raw: () => {
      rawMode = true;
    },
  };
}
async function connect(s: ReturnType<typeof setup>) {
  await s.client.connect("owner", "private-backups", "main");
}
describe("personal GitHub backups", () => {
  it("connects to a private repo without storing credentials, previews before one-time upload", async () => {
    const s = setup();
    await connect(s);
    const snapshot = fixture();
    const p = await s.client.prepareBackup(snapshot);
    expect(s.puts).toHaveLength(0);
    expect(p.remote).toBeNull();
    const result = await s.client.uploadBackup(p);
    expect(result.commit).toBe(commit);
    expect(s.puts[0].sha).toBeUndefined();
    expect(s.puts[0].branch).toBe("main");
    expect(JSON.stringify(s.puts)).not.toContain(token);
    expect(JSON.stringify(s.client)).not.toContain(token);
    await expect(s.client.uploadBackup(p)).rejects.toThrow("失效");
    expect(
      s.requests.every((r) => r.url.startsWith("https://api.github.com/")),
    ).toBe(true);
    expect(
      s.requests.every(
        (r) =>
          r.options.credentials === "omit" &&
          r.options.redirect === "error" &&
          r.options.headers.Authorization === `Bearer ${token}`,
      ),
    ).toBe(true);
  });
  it("uses original immutable bytes and expected blob sha for an update", async () => {
    const s = setup();
    await connect(s);
    const snapshot = fixture();
    s.remote(structuredClone(snapshot));
    snapshot.revision = 2;
    const p = await s.client.prepareBackup(snapshot);
    expect(p.remote?.sha).toBe(blob);
    p.path = "unsafe";
    p.bytes = new ArrayBuffer(0);
    p.revision = 999;
    await s.client.uploadBackup(p);
    expect(s.puts[0].sha).toBe(blob);
    expect(s.puts[0].message).toContain("2");
    expect(Buffer.from(s.puts[0].content, "base64").length).toBeGreaterThan(0);
  });
  it("refuses remote branch race before PUT and requires new preview", async () => {
    const s = setup();
    await connect(s);
    const p = await s.client.prepareBackup(fixture());
    s.head(commit);
    await expect(s.client.uploadBackup(p)).rejects.toThrow("已改變");
    expect(s.puts).toHaveLength(0);
    await expect(s.client.uploadBackup(p)).rejects.toThrow("失效");
  });
  it("rejects public repo, invalid hosts and tokens without revealing credentials", async () => {
    const s = setup();
    s.private(false);
    await expect(connect(s)).rejects.toThrow("私有");
    await expect(s.client.prepareBackup(fixture())).rejects.toThrow("先連接");
    await expect(
      s.client.connect("https://evil.test", "x", "main"),
    ).rejects.toThrow("擁有者");
    expect(() => new GitHubBackupClient("ghp_unsafe")).toThrow("fine-grained");
  });
  it("stops on stale or divergent revision and mismatched workspace", async () => {
    const s = setup();
    await connect(s);
    const local = fixture();
    const newer = structuredClone(local);
    newer.revision = 3;
    s.remote(newer);
    await expect(s.client.prepareBackup(local)).rejects.toThrow("高於");
    newer.revision = 0;
    newer.workspace.name = "another";
    s.remote(newer);
    await expect(s.client.prepareBackup(local)).rejects.toThrow("分歧");
    s.remote(fixture());
    await expect(s.client.prepareBackup(local)).rejects.toThrow("工作區");
    expect(s.puts).toHaveLength(0);
  });
  it("lists and validates versions without writing or restoring local data", async () => {
    const s = setup();
    await connect(s);
    const snapshot = fixture();
    s.remote(snapshot);
    const rows = await s.client.listBackups();
    expect(rows[0].workspaceId).toBe(snapshot.workspaceId);
    const versions = await s.client.history(rows[0].path);
    expect(versions[0].sha).toBe(commit);
    const downloaded = await s.client.downloadBackup(rows[0].path, commit);
    expect(downloaded.snapshot).toEqual(snapshot);
    expect(s.puts).toHaveLength(0);
    await expect(s.client.downloadBackup("other/secrets.xlsx")).rejects.toThrow(
      "路徑",
    );
  });
  it("rechecks privacy immediately before writing", async () => {
    const s = setup();
    await connect(s);
    const p = await s.client.prepareBackup(fixture());
    s.private(false);
    await expect(s.client.uploadBackup(p)).rejects.toThrow("私有");
    expect(s.puts).toHaveLength(0);
  });
  it("rejects write conflicts without a success or automatic retry", async () => {
    const s = setup();
    await connect(s);
    const p = await s.client.prepareBackup(fixture());
    s.status(409, true);
    await expect(s.client.uploadBackup(p)).rejects.toThrow("遠端已變更");
    expect(s.requests.filter((r) => r.options.method === "PUT")).toHaveLength(
      1,
    );
    await expect(s.client.uploadBackup(p)).rejects.toThrow("失效");
  });
  it("uses authenticated raw media on fixed API host for larger content metadata", async () => {
    const s = setup();
    await connect(s);
    const snapshot = fixture();
    s.remote(snapshot);
    s.raw();
    const result = await s.client.downloadBackup(
      `conmate/workspaces/${snapshot.workspaceId}/project.xlsx`,
    );
    expect(result.snapshot).toEqual(snapshot);
    expect(
      s.requests.some((r) => r.options.headers.Accept.includes(".raw")),
    ).toBe(true);
  });
  it("redacts provider errors and disconnect invalidates previews", async () => {
    const s = setup();
    await connect(s);
    const p = await s.client.prepareBackup(fixture());
    s.status(401);
    try {
      await s.client.uploadBackup(p);
      throw Error("expected");
    } catch (e) {
      expect(String(e)).not.toContain(token);
      expect(String(e)).toContain("到期");
    }
    s.status(0);
    const next = await s.client.prepareBackup(fixture());
    s.client.disconnect();
    await expect(s.client.uploadBackup(next)).rejects.toThrow("先連接");
    expect(JSON.stringify(s.client)).not.toContain(token);
  });
});
