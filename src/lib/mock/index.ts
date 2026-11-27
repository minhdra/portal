/* Mock API trong bộ nhớ, chỉ dùng khi NEXT_PUBLIC_MOCK=1. Dữ liệu mẫu trung tính. */
import { hooks } from "../api-client";
import type { FileInfo, Item, ItemType, Tag, Topic } from "../types";
import { makePdf, makePng } from "./pdf";

interface MItem extends Omit<Item, "tags"> { tags: Tag[] }
interface MTopic { id: string; parentId: string | null; name: string; slug: string; icon: string | null; sortOrder: number }
interface MFile extends FileInfo { itemId: string; blob: Blob; url: string; view?: unknown }
interface MVersion { version: number; createdAt: string; author: string; markdown: string }

const now = () => new Date().toISOString();
const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase();
const slugify = (s: string) => plain(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
let seq = 100;
const uid = (p: string) => `${p}-${++seq}`;

const user = { id: "u-1", username: "admin", displayName: "Quản trị", role: "admin", mustChangePassword: false };
let loggedIn = true;
/** Mật khẩu mẫu duy nhất của bản mock. */
export const DEMO_PASSWORD = "portal-demo-123";

const topics: MTopic[] = [
  { id: "t-hy", parentId: null, name: "Hưng Yên", slug: "hung-yen", icon: "map", sortOrder: 0 },
  { id: "t-pt", parentId: null, name: "Phú Thọ", slug: "phu-tho", icon: "map", sortOrder: 1 },
  { id: "t-pta", parentId: "t-pt", name: "Huyện A", slug: "huyen-a", icon: "folder", sortOrder: 0 },
  { id: "t-ht", parentId: null, name: "Hạ tầng", slug: "ha-tang", icon: "server", sortOrder: 2 },
  { id: "t-mb", parentId: null, name: "Mẫu biểu chung", slug: "mau-bieu-chung", icon: "doc", sortOrder: 3 },
];
const tagList: Tag[] = [];
const tag = (n: string): Tag => {
  let t = tagList.find((x) => x.name.toLowerCase() === n.toLowerCase());
  if (!t) tagList.push((t = { id: uid("g"), name: n, slug: slugify(n) }));
  return t;
};
let order = 0;
const mk = (p: Partial<MItem> & { id: string; type: ItemType; title: string }, tags: string[] = []): MItem => ({
  description: null, url: null, icon: null, status: "active", topicId: "t-hy", pinned: false,
  sortOrder: order++, fileCount: 0, createdAt: ago(200), updatedAt: ago(30), lastOpenedAt: null, ...p, tags: tags.map(tag),
});
const items: MItem[] = [
  mk({ id: "i-1", type: "tool", title: "Công cụ gộp dữ liệu", description: "Gộp và đối chiếu các bảng theo mã", url: "https://tool.example.local/", icon: "tool", pinned: true, lastOpenedAt: ago(2) }, ["Dữ liệu"]),
  mk({ id: "i-2", type: "web", title: "Trang theo dõi tiến độ", description: "Bảng số liệu cập nhật theo ngày", url: "https://tiendo.example.local/", icon: "web", pinned: true, lastOpenedAt: ago(5) }, ["Báo cáo"]),
  mk({ id: "i-3", type: "doc", title: "Tài liệu họp tuần", description: "Quy trình, biên bản và bảng tổng hợp", icon: "doc", fileCount: 3, lastOpenedAt: ago(26) }, ["Hướng dẫn", "Báo cáo"]),
  mk({ id: "i-4", type: "note", title: "Ghi chú cấu hình", description: "Markdown, 3 phiên bản", icon: "note", lastOpenedAt: ago(1) }, ["Cấu hình"]),
  mk({ id: "i-5", type: "tool", title: "Công cụ đổi tên tệp", description: "Đổi tên hàng loạt theo mẫu", url: "/rename/", icon: "tool" }, ["Tệp"]),
  mk({ id: "i-6", type: "web", title: "Bản đồ tra cứu", description: "Tra cứu theo vị trí", url: "https://map.example.local/", icon: "map" }, ["Bản đồ"]),
  mk({ id: "i-7", type: "doc", title: "Ảnh hiện trường mẫu", description: "Một ảnh minh hoạ", icon: "image", fileCount: 1 }, ["Hình ảnh"]),
  mk({ id: "i-8", type: "link", title: "Cổng thông tin chung", description: "Liên kết ngoài", url: "https://example.org/", icon: "link" }, ["Tham khảo"]),
  mk({ id: "i-9", type: "tool", title: "Bộ kiểm tra tệp", description: "Kiểm tra định dạng trước khi nộp", url: "https://check.example.local/", icon: "tool", topicId: "t-pt" }, ["Tệp"]),
  mk({ id: "i-10", type: "web", title: "Báo cáo tổng hợp huyện", description: "Số liệu theo huyện", url: "https://huyen.example.local/", icon: "web", topicId: "t-pta" }, ["Báo cáo"]),
  mk({ id: "i-11", type: "doc", title: "Mẫu biểu đề nghị", description: "Mẫu dùng chung", icon: "doc", topicId: "t-mb" }, ["Mẫu"]),
  mk({ id: "i-12", type: "web", title: "Trang cũ đã lưu trữ", description: "Không còn dùng", url: "https://cu.example.local/", icon: "web", status: "archived" }, ["Cũ"]),
];

const files: MFile[] = [];
const versions: Record<string, MVersion[]> = {
  "i-4": [
    { version: 1, createdAt: ago(72), author: "Quản trị", markdown: "# Cấu hình dịch vụ\n\nTài liệu ngắn về cách đặt cấu hình." },
    { version: 2, createdAt: ago(30), author: "Quản trị", markdown: "# Cấu hình dịch vụ\n\nTài liệu ngắn về cách đặt cấu hình.\n\n## Các bước\n\n- Sao chép tệp mẫu\n- Điền giá trị cho từng khoá" },
    { version: 3, createdAt: ago(3), author: "Quản trị", markdown: "# Cấu hình dịch vụ\n\nTài liệu ngắn về cách đặt cấu hình.\n\n## Các bước\n\n- Sao chép tệp mẫu\n- Điền giá trị cho từng khoá\n- Khởi động lại dịch vụ\n\n```\nPORT=8080\nMODE=demo\n```\n\n| Khoá | Ý nghĩa |\n| --- | --- |\n| PORT | Cổng lắng nghe |\n| MODE | Chế độ chạy |\n\nXem thêm [hướng dẫn](https://example.org/).\n" },
  ],
};

async function seedFiles() {
  const add = (itemId: string, id: string, name: string, mime: string, blob: Blob, view?: unknown) =>
    files.push({ id, itemId, originalName: name, mime, size: blob.size, blob, url: URL.createObjectURL(blob), view });
  add("i-3", "f-1", "Hướng dẫn quy trình.pdf", "application/pdf", makePdf("Quy trinh xu ly ho so", [
    "Tai lieu mo ta cac buoc tiep nhan, kiem tra va ban giao ho so.",
    "Moi so lieu trong ban nay la du lieu mau.", "", "1. Tiep nhan", "2. Kiem tra", "3. Ban giao"]));
  const docxHtml = `<h1>Biên bản họp tuần</h1><p><strong>Thời gian:</strong> 20/11, 09:00. <strong>Thành phần:</strong> các bộ phận liên quan.</p><h2>Nội dung</h2><ul><li>Rà soát tiến độ tuần trước</li><li>Thống nhất kế hoạch tuần tới</li></ul><table><tr><th>Việc</th><th>Phụ trách</th><th>Hạn</th></tr><tr><td>Gộp dữ liệu</td><td>Bộ phận A</td><td>25/11</td></tr><tr><td>Rà soát biểu mẫu</td><td>Bộ phận B</td><td>27/11</td></tr></table><p>Mọi số liệu là dữ liệu mẫu.</p>`;
  add("i-3", "f-2", "Biên bản họp.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", new Blob(["docx"]), { kind: "html", html: docxHtml });
  const rows = [["Mã", "Hạng mục", "Số lượng", "Ghi chú"]];
  for (let i = 1; i <= 24; i++) rows.push([`H${String(i).padStart(3, "0")}`, `Hạng mục mẫu ${i}`, String(i * 7 + 3), i % 5 === 0 ? "Cần rà soát" : ""]);
  add("i-3", "f-3", "Bảng tổng hợp tháng.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", new Blob(["xlsx"]), {
    kind: "sheets", sheets: [
      { name: "Tổng hợp", rows, truncated: false },
      { name: "Chi tiết", rows: [["Tuần", "Hoàn thành", "Còn lại"], ["1", "12", "30"], ["2", "20", "22"], ["3", "31", "11"]], truncated: false },
      { name: "Ghi chú", rows: [["Nội dung"], ["Dữ liệu mẫu, không phải số liệu thật."]], truncated: false },
    ],
  });
  add("i-7", "f-4", "anh-hien-truong.png", "image/png", await makePng());
}

function topicTree(): Topic[] {
  const cnt = (id: string): number => items.filter((i) => i.status === "active" && i.topicId === id).length;
  const build = (parent: string | null): Topic[] =>
    topics.filter((t) => t.parentId === parent).sort((a, b) => a.sortOrder - b.sortOrder).map((t) => {
      const children = build(t.id);
      return { ...t, itemCount: cnt(t.id) + children.reduce((s, c) => s + c.itemCount, 0), children };
    });
  return build(null);
}
const descendants = (id: string): string[] => [id, ...topics.filter((t) => t.parentId === id).flatMap((t) => descendants(t.id))];

class HttpErr { constructor(public status: number, public code: string, public message: string, public fields?: Record<string, string>) {} }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const fileInfo = (f: MFile): FileInfo => ({ id: f.id, originalName: f.originalName, mime: f.mime, size: f.size });
const toItem = (i: MItem): Item => ({ ...i, fileCount: files.filter((f) => f.itemId === i.id).length });
const need = <T,>(x: T | undefined, what = "Không tìm thấy."): T => { if (!x) throw new HttpErr(404, "not_found", what); return x; };

async function route(method: string, url: URL, body: unknown, init?: RequestInit): Promise<Response> {
  const p = url.pathname.replace(/^\/api/, "");
  const sp = url.searchParams;
  const b = (body ?? {}) as Record<string, any>;
  let m: RegExpMatchArray | null;

  if (p === "/health") return json({ ok: true });
  if (p === "/auth/login" && method === "POST") {
    if (b.username === "admin" && b.password === DEMO_PASSWORD) { loggedIn = true; return json({ user }); }
    throw new HttpErr(401, "unauthenticated", "Sai tên đăng nhập hoặc mật khẩu.");
  }
  if (!loggedIn) throw new HttpErr(401, "unauthenticated", "Bạn chưa đăng nhập.");
  if (user.mustChangePassword && !p.startsWith("/auth/")) throw new HttpErr(403, "must_change_password", "Bạn cần đổi mật khẩu trước khi tiếp tục.");
  if (p === "/auth/logout") { loggedIn = false; return new Response(null, { status: 204 }); }
  if (p === "/auth/me") return json({ user });
  if (p === "/auth/change-password") {
    if (b.currentPassword !== DEMO_PASSWORD) throw new HttpErr(422, "validation", "Dữ liệu không hợp lệ.", { currentPassword: "Mật khẩu hiện tại không đúng." });
    user.mustChangePassword = false;
    return new Response(null, { status: 204 });
  }

  if (p === "/topics" && method === "GET") return json({ topics: topicTree() });
  if (p === "/topics" && method === "POST") {
    if (!String(b.name ?? "").trim()) throw new HttpErr(422, "validation", "Dữ liệu không hợp lệ.", { name: "Nhập tên topic." });
    const siblings = topics.filter((t) => t.parentId === (b.parentId ?? null));
    const t: MTopic = { id: uid("t"), parentId: b.parentId ?? null, name: b.name.trim(), slug: slugify(b.name), icon: b.icon ?? "folder", sortOrder: siblings.length };
    topics.push(t);
    return json({ ...t, itemCount: 0, children: [] }, 201);
  }
  if (p === "/topics/reorder") {
    (b.ids as string[]).forEach((id, i) => { const t = topics.find((x) => x.id === id); if (t) t.sortOrder = i; });
    return new Response(null, { status: 204 });
  }
  if ((m = p.match(/^\/topics\/([^/]+)$/))) {
    const t = need(topics.find((x) => x.id === m![1]));
    if (method === "PATCH") {
      if ("parentId" in b && b.parentId && descendants(t.id).includes(b.parentId)) throw new HttpErr(409, "conflict", "Không thể chuyển topic vào chính nó hoặc topic con của nó.");
      if ("name" in b && !String(b.name).trim()) throw new HttpErr(422, "validation", "Dữ liệu không hợp lệ.", { name: "Nhập tên topic." });
      if (b.name) { t.name = b.name.trim(); t.slug = slugify(b.name); }
      if ("parentId" in b) t.parentId = b.parentId ?? null;
      if (b.icon) t.icon = b.icon;
      return json({ ...t, itemCount: 0, children: [] });
    }
    if (method === "DELETE") {
      if (topics.some((x) => x.parentId === t.id) || items.some((i) => i.topicId === t.id)) throw new HttpErr(409, "conflict", "Topic còn mục hoặc topic con, chưa thể xoá.");
      topics.splice(topics.indexOf(t), 1);
      return new Response(null, { status: 204 });
    }
  }

  if (p === "/tags") return json({ tags: tagList.map((t) => ({ ...t, count: items.filter((i) => i.status === "active" && i.tags.some((x) => x.id === t.id)).length })).filter((t) => t.count > 0) });
  if (p === "/search") {
    const q = plain(sp.get("q") ?? "");
    const hit = (i: MItem) => i.status === "active" && plain(`${i.title} ${i.description ?? ""} ${i.tags.map((t) => t.name).join(" ")}`).includes(q);
    return json({ items: items.filter(hit).map(toItem), topics: topicTree().flatMap(function f(t): Topic[] { return [t, ...t.children.flatMap(f)]; }).filter((t) => plain(t.name).includes(q)) });
  }
  if (p === "/items" && method === "GET") {
    let list = items.filter((i) => i.status === (sp.get("status") ?? "active"));
    if (sp.get("topic")) { const ids = descendants(sp.get("topic")!); list = list.filter((i) => i.topicId && ids.includes(i.topicId)); }
    if (sp.get("type")) list = list.filter((i) => i.type === sp.get("type") || (sp.get("type") === "web" && i.type === "link"));
    if (sp.get("tag")) list = list.filter((i) => i.tags.some((t) => t.slug === sp.get("tag")));
    if (sp.get("pinned")) list = list.filter((i) => i.pinned);
    if (sp.get("q")) { const q = plain(sp.get("q")!); list = list.filter((i) => plain(`${i.title} ${i.description ?? ""} ${i.tags.map((t) => t.name).join(" ")}`).includes(q)); }
    if (sp.get("recent")) list = list.filter((i) => i.lastOpenedAt).sort((a, b) => b.lastOpenedAt!.localeCompare(a.lastOpenedAt!));
    else list = [...list].sort((a, b) => a.sortOrder - b.sortOrder);
    return json({ items: list.map(toItem), nextCursor: null });
  }
  if (p === "/items" && method === "POST") {
    const errs: Record<string, string> = {};
    if (!String(b.title ?? "").trim()) errs.title = "Nhập tiêu đề.";
    if (["tool", "web", "link"].includes(b.type) && !b.url) errs.url = "Nhập địa chỉ đích.";
    else if (b.url && !/^(https?:\/\/|\/[^/])/.test(b.url)) errs.url = "Địa chỉ phải bắt đầu bằng http://, https:// hoặc /.";
    if (Object.keys(errs).length) throw new HttpErr(422, "validation", "Dữ liệu không hợp lệ.", errs);
    const it = mk({ id: uid("i"), type: b.type, title: b.title.trim(), description: b.description || null, url: b.url || null, icon: b.icon || null, topicId: b.topicId ?? null, pinned: !!b.pinned, status: b.status ?? "active", createdAt: now(), updatedAt: now() }, b.tags ?? []);
    items.push(it);
    if (it.type === "note") versions[it.id] = [{ version: 1, createdAt: now(), author: "Quản trị", markdown: `# ${it.title}\n\n` }];
    return json(toItem(it), 201);
  }
  if (p === "/items/reorder") {
    (b.ids as string[]).forEach((id, i) => { const it = items.find((x) => x.id === id); if (it) it.sortOrder = i; });
    return new Response(null, { status: 204 });
  }
  if ((m = p.match(/^\/items\/([^/]+)$/))) {
    const it = need(items.find((x) => x.id === m![1]));
    if (method === "GET") return json({ ...toItem(it), files: files.filter((f) => f.itemId === it.id).map(fileInfo) });
    if (method === "PATCH") {
      if ("title" in b && !String(b.title).trim()) throw new HttpErr(422, "validation", "Dữ liệu không hợp lệ.", { title: "Nhập tiêu đề." });
      if (b.url && !/^(https?:\/\/|\/[^/])/.test(b.url)) throw new HttpErr(422, "validation", "Dữ liệu không hợp lệ.", { url: "Địa chỉ phải bắt đầu bằng http://, https:// hoặc /." });
      for (const k of ["title", "description", "url", "icon", "topicId", "status", "pinned", "type"] as const) if (k in b) (it as any)[k] = b[k] === "" ? null : b[k];
      if (b.tags) it.tags = (b.tags as string[]).map(tag);
      it.updatedAt = now();
      return json(toItem(it));
    }
    if (method === "DELETE") {
      if (sp.get("hard")) items.splice(items.indexOf(it), 1); else it.status = "archived";
      return new Response(null, { status: 204 });
    }
  }
  if ((m = p.match(/^\/items\/([^/]+)\/open$/))) { need(items.find((x) => x.id === m![1])).lastOpenedAt = now(); return new Response(null, { status: 204 }); }
  if ((m = p.match(/^\/items\/([^/]+)\/files$/))) {
    const it = need(items.find((x) => x.id === m![1]));
    if (method === "GET") return json({ files: files.filter((f) => f.itemId === it.id).map(fileInfo) });
    const fd = (init?.body ?? null) as FormData | null;
    const out: FileInfo[] = [];
    for (const v of fd?.getAll("file") ?? []) {
      if (!(v instanceof File)) continue;
      if (v.size > 50 * 1024 * 1024) throw new HttpErr(422, "validation", "Tệp vượt quá 50 MB.", { file: "Tệp vượt quá 50 MB." });
      const blob = new Blob([await v.arrayBuffer()], { type: v.type });
      const f: MFile = { id: uid("f"), itemId: it.id, originalName: v.name, mime: v.type || "application/octet-stream", size: v.size, blob, url: URL.createObjectURL(blob) };
      files.push(f); out.push(fileInfo(f));
    }
    return json({ files: out }, 201);
  }
  if ((m = p.match(/^\/files\/([^/]+)(\/view)?$/))) {
    const f = need(files.find((x) => x.id === m![1]));
    if (m[2]) { if (!f.view) throw new HttpErr(415, "unsupported", "Không xem được định dạng này."); return json(f.view); }
    if (method === "DELETE") { files.splice(files.indexOf(f), 1); return new Response(null, { status: 204 }); }
    return new Response(f.blob, { headers: { "Content-Type": f.mime } });
  }

  if ((m = p.match(/^\/items\/([^/]+)\/note(?:\/(.*))?$/))) {
    const id = m[1];
    const it = need(items.find((x) => x.id === id));
    const vs = (versions[id] ??= [{ version: 1, createdAt: now(), author: "Quản trị", markdown: "" }]);
    const cur = vs[vs.length - 1];
    const sub = m[2];
    if (!sub) {
      if (method === "GET") return json({ markdown: cur.markdown, version: cur.version, updatedAt: cur.createdAt });
      if (typeof b.markdown !== "string") throw new HttpErr(422, "validation", "Dữ liệu không hợp lệ.", { markdown: "Thiếu nội dung." });
      if (b.baseVersion !== cur.version) throw new HttpErr(409, "conflict", "Ghi chú đã có phiên bản mới hơn.");
      vs.push({ version: cur.version + 1, createdAt: now(), author: "Quản trị", markdown: b.markdown });
      it.updatedAt = now();
      return json({ version: cur.version + 1 });
    }
    if (sub === "versions") return json({ versions: [...vs].reverse().map((v) => ({ version: v.version, createdAt: v.createdAt, author: v.author, size: v.markdown.length })) });
    if (sub === "export") return new Response(new Blob([cur.markdown], { type: "text/markdown" }));
    const mv = sub.match(/^versions\/(\d+)(\/restore)?$/);
    if (mv) {
      const v = need(vs.find((x) => x.version === Number(mv[1])));
      if (mv[2]) { vs.push({ version: cur.version + 1, createdAt: now(), author: "Quản trị", markdown: v.markdown }); return json({ version: cur.version + 1 }); }
      return json({ version: v.version, markdown: v.markdown });
    }
  }
  throw new HttpErr(404, "not_found", "Không tìm thấy.");
}

let installed: Promise<void> | null = null;
export function installMock(): Promise<void> {
  return (installed ??= (async () => {
    await seedFiles();
    // ?mock=empty: bắt đầu không có topic/item để xem trạng thái trống.
    const flag = new URLSearchParams(window.location.search).get("mock");
    if (flag === "empty") { topics.length = 0; items.length = 0; }
    // ?mock=anon: chưa đăng nhập (thử 401). ?mock=mustchange: buộc đổi mật khẩu (thử 403).
    if (flag === "anon") loggedIn = false;
    if (flag === "mustchange") user.mustChangePassword = true;
    hooks.fileUrl = (id) => files.find((f) => f.id === id)?.url ?? `/api/files/${id}`;
    const real = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, window.location.origin);
      if (!url.pathname.startsWith("/api/")) return real(input, init);
      await new Promise((r) => setTimeout(r, 120));
      let body: unknown;
      if (typeof init?.body === "string") { try { body = JSON.parse(init.body); } catch { /* bỏ */ } }
      try {
        return await route((init?.method ?? "GET").toUpperCase(), url, body, init);
      } catch (e) {
        if (e instanceof HttpErr) return json({ error: { code: e.code, message: e.message, fields: e.fields } }, e.status);
        throw e;
      }
    };
  })());
}
