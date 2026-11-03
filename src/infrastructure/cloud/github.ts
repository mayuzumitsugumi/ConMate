import type { CatalogSnapshot } from "../../domain/models/catalog";
import { validateRestoreSnapshot } from "../../domain/validation/restore";
import { projectBytes } from "../../application/export-project";
import { checkProjectFile } from "../../application/restore-project";
const API = "https://api.github.com";
const MAX = 10 * 1024 * 1024;
type Remote = { snapshot: CatalogSnapshot; sha: string };
export interface PreparedBackup {
  workspaceId: string;
  revision: number;
  path: string;
  remote: Remote | null;
  expectedHead: string;
  bytes: ArrayBuffer;
  snapshot: CatalogSnapshot;
}
interface Dependencies {
  fetch: typeof fetch;
  encode: (snapshot: CatalogSnapshot) => Promise<ArrayBuffer>;
  inspect: (bytes: ArrayBuffer) => Promise<CatalogSnapshot>;
}
const defaults: Dependencies = {
  fetch: (...args) => fetch(...args),
  encode: projectBytes,
  inspect: (bytes) =>
    checkProjectFile(new File([bytes], "GitHub-project.xlsx")),
};
function fail(message: string): never {
  throw new Error(message);
}
function sha(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{40,64}$/i.test(value))
    fail("GitHub 回應的版本識別不正確。");
  return value;
}
function base64(bytes: ArrayBuffer) {
  const data = new Uint8Array(bytes);
  let text = "";
  for (let i = 0; i < data.length; i += 8192)
    text += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(text);
}
function decode(value: unknown): ArrayBuffer {
  if (typeof value !== "string" || value.length > MAX * 1.4 + 10000)
    fail("遠端備份超過 10 MB 或內容不正確。");
  let text: string;
  try {
    text = atob(value.replace(/\s/g, ""));
  } catch {
    return fail("遠端備份編碼不正確。");
  }
  if (text.length > MAX) fail("遠端備份超過 10 MB。");
  return Uint8Array.from(text, (c) => c.charCodeAt(0)).buffer;
}
function pathFor(id: string) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id))
    fail("工作區識別碼不支援此備份路徑，請先保留本機檔案。");
  return `conmate/workspaces/${id}/project.xlsx`;
}
function validPath(path: string) {
  if (!/^conmate\/workspaces\/[A-Za-z0-9_-]{1,100}\/project\.xlsx$/.test(path))
    fail("只能讀取 ConMate 工作區備份路徑。");
  return path.split("/").map(encodeURIComponent).join("/");
}
/** Credentials live only in this object. Never serialize this client. */
export class GitHubBackupClient {
  #token: string;
  #connected = false;
  #prefix = "";
  #branch = "";
  #generation = 0;
  #prepared = new WeakMap<PreparedBackup, PreparedBackup>();
  #deps: Dependencies;
  constructor(token: string, deps: Partial<Dependencies> = {}) {
    if (!/^github_pat_[A-Za-z0-9_]{20,}$/.test(token.trim()))
      fail(
        "請輸入限定專用儲存庫的 fine-grained personal access token（github_pat_ 開頭）。",
      );
    this.#token = token.trim();
    this.#deps = { ...defaults, ...deps };
  }
  disconnect() {
    this.#token = "";
    this.#connected = false;
    this.#generation++;
    this.#prepared = new WeakMap();
  }
  async #request(
    path: string,
    method = "GET",
    body?: unknown,
    missing = false,
    raw = false,
  ) {
    if (!this.#token) fail("已斷開連線，請重新連接。");
    const generation = this.#generation;
    let response: Response;
    try {
      response = await this.#deps.fetch(API + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.#token}`,
          Accept: raw
            ? "application/vnd.github.raw+json"
            : "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      return fail(
        "無法連接 GitHub（可能離線、逾時或瀏覽器阻擋）。本機資料未更動；若剛送出備份，請重新檢查遠端結果，勿直接重送。",
      );
    }
    if (generation !== this.#generation || !this.#token)
      fail("連線已中斷，請重新連接並檢查遠端狀態。");
    if (response.status === 404 && missing) return null;
    if (!response.ok) {
      const messages: Record<number, string> = {
        401: "權杖無效或到期，請重新授權。",
        403: "權限不足、儲存庫尚待核准或 GitHub 限流；請稍後檢查。",
        404: "找不到儲存庫、分支或備份，或未取得存取權。",
        409: "遠端已變更或儲存庫尚未初始化，請重新預覽。",
        422: "GitHub 拒絕寫入；請重新預覽並檢查分支保護及權限。",
      };
      fail(messages[response.status] || "GitHub 操作未完成，請稍後重新檢查。");
    }
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX * 1.5) fail("GitHub 回應過大，請使用較小的專案檔。");
    if (raw) {
      const data = await response.arrayBuffer();
      if (data.byteLength > MAX) fail("遠端備份超過 10 MB。");
      if (generation !== this.#generation || !this.#token)
        fail("連線已中斷，請重新連接。");
      return data;
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      return fail("GitHub 回應未完整接收，請重新檢查遠端狀態。");
    }
    if (generation !== this.#generation || !this.#token)
      fail("連線已中斷，請重新連接。");
    if (text.length > MAX * 1.5) fail("GitHub 回應過大。");
    try {
      return JSON.parse(text);
    } catch {
      return fail("GitHub 回應格式不正確。");
    }
  }
  #require() {
    if (!this.#connected || !this.#token)
      fail("請先連接自己的私有 GitHub 儲存庫。");
  }
  async #head() {
    const r = await this.#request(
      `${this.#prefix}/branches/${encodeURIComponent(this.#branch)}`,
    );
    return sha(r?.commit?.sha);
  }
  async connect(owner: string, repo: string, branch: string) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(owner) ||
      !/^[A-Za-z0-9._-]{1,100}$/.test(repo) ||
      repo === "." ||
      repo === ".."
    )
      fail("請分別填 GitHub 擁有者與儲存庫名稱，不要填完整網址。");
    if (!branch || branch.length > 200 || /[\s\x00-\x1f?&#]/.test(branch))
      fail("請填有效的已存在分支名稱。");
    this.#connected = false;
    this.#generation++;
    this.#prepared = new WeakMap();
    const user = await this.#request("/user");
    if (typeof user?.login !== "string") fail("無法確認 GitHub 帳號。");
    this.#prefix = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    this.#branch = branch;
    await this.#assertPrivate();
    await this.#head();
    this.#connected = true;
    return { login: user.login, owner, repo, branch };
  }
  async #assertPrivate() {
    const metadata = await this.#request(this.#prefix);
    if (metadata?.private !== true || metadata?.visibility === "public")
      fail("為避免公開財務資料，只接受私有儲存庫；請自行建立專用私有儲存庫。");
    if (
      metadata?.archived ||
      metadata?.disabled ||
      metadata?.permissions?.push === false
    )
      fail("此儲存庫無法寫入，請檢查 Contents 讀寫權限與封存狀態。");
  }
  async #remote(
    path: string,
    ref: string,
    missing = false,
  ): Promise<Remote | null> {
    const r = await this.#request(
      `${this.#prefix}/contents/${validPath(path)}?ref=${encodeURIComponent(ref)}`,
      "GET",
      undefined,
      missing,
    );
    if (r === null) return null;
    if (
      r?.type !== "file" ||
      !["base64", "none"].includes(r?.encoding) ||
      !Number.isSafeInteger(r.size) ||
      r.size < 1 ||
      r.size > MAX
    )
      fail("遠端備份不是支援的 XLSX 檔案或超過 10 MB。");
    const bytes: ArrayBuffer =
      r.encoding === "base64"
        ? decode(r.content)
        : await this.#request(
            `${this.#prefix}/contents/${validPath(path)}?ref=${encodeURIComponent(ref)}`,
            "GET",
            undefined,
            false,
            true,
          );
    if (bytes.byteLength !== r.size) fail("遠端備份長度不一致。");
    const snapshot = validateRestoreSnapshot(await this.#deps.inspect(bytes));
    if (path !== pathFor(snapshot.workspaceId))
      fail("遠端檔案工作區與路徑不符，不會覆蓋。");
    return { snapshot, sha: sha(r.sha) };
  }
  async prepareBackup(input: CatalogSnapshot): Promise<PreparedBackup> {
    this.#require();
    const generation = this.#generation;
    await this.#assertPrivate();
    const snapshot = validateRestoreSnapshot(structuredClone(input)),
      path = pathFor(snapshot.workspaceId);
    const expectedHead = await this.#head();
    const remote = await this.#remote(path, expectedHead, true);
    if (remote && remote.snapshot.revision > snapshot.revision)
      fail(
        "遠端修訂高於本機，可能有另一裝置的新資料。請先下載遠端並預覽還原，不會以舊版覆蓋。",
      );
    if (
      remote &&
      remote.snapshot.revision === snapshot.revision &&
      JSON.stringify(remote.snapshot) !== JSON.stringify(snapshot)
    )
      fail(
        "相同修訂的本機與遠端內容不同，可能已分歧。請先下載核對，不會自動覆蓋。",
      );
    const bytes = await this.#deps.encode(snapshot);
    if (bytes.byteLength > MAX) fail("專案檔超過 10 MB，請改用本機匯出。");
    const prepared = {
      workspaceId: snapshot.workspaceId,
      revision: snapshot.revision,
      path,
      remote,
      expectedHead,
      bytes,
      snapshot,
    };
    this.#require();
    if (generation !== this.#generation) fail("連線已變更，請重新預覽備份。");
    this.#prepared.set(prepared, structuredClone(prepared));
    return prepared;
  }
  async uploadBackup(prepared: PreparedBackup) {
    this.#require();
    const stored = this.#prepared.get(prepared);
    if (!stored) fail("備份預覽已失效，請重新預覽。");
    this.#prepared.delete(prepared);
    prepared = stored; // exactly one attempt; errors require a fresh preview
    await this.#assertPrivate();
    if ((await this.#head()) !== prepared.expectedHead)
      fail("預覽後遠端分支已改變，請重新讀取；不會強制覆蓋。");
    const r = await this.#request(
      `${this.#prefix}/contents/${validPath(prepared.path)}`,
      "PUT",
      {
        message: `ConMate backup revision ${prepared.revision}`,
        branch: this.#branch,
        content: base64(prepared.bytes),
        ...(prepared.remote ? { sha: prepared.remote.sha } : {}),
      },
    );
    return {
      commit: sha(r?.commit?.sha),
      sha: sha(r?.content?.sha),
      at: new Date().toISOString(),
    };
  }
  async listBackups() {
    this.#require();
    const head = await this.#head();
    const rows = await this.#request(
      `${this.#prefix}/contents/conmate/workspaces?ref=${head}`,
      "GET",
      undefined,
      true,
    );
    if (rows === null) return [];
    if (!Array.isArray(rows) || rows.length > 1000)
      fail("遠端工作區清單不正確或過大。");
    return rows
      .filter((r) => r.type === "dir" && /^[A-Za-z0-9_-]{1,100}$/.test(r.name))
      .map((r) => ({ workspaceId: r.name as string, path: pathFor(r.name) }));
  }
  async downloadBackup(path: string, ref?: string) {
    this.#require();
    if (ref) sha(ref);
    const remote = await this.#remote(path, ref || (await this.#head()));
    if (!remote) fail("找不到遠端備份。");
    return remote;
  }
  async history(path: string) {
    this.#require();
    validPath(path);
    const r = await this.#request(
      `${this.#prefix}/commits?sha=${encodeURIComponent(this.#branch)}&path=${encodeURIComponent(path)}&per_page=20`,
    );
    if (!Array.isArray(r)) fail("無法讀取版本紀錄。");
    return r.map((c) => ({
      sha: sha(c.sha),
      date:
        typeof c.commit?.committer?.date === "string"
          ? c.commit.committer.date
          : "",
      message:
        typeof c.commit?.message === "string"
          ? c.commit.message.slice(0, 200)
          : "",
    }));
  }
}
