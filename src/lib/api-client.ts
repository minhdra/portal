import type {
  FileInfo, FileView, Item, ItemInput, ItemQuery, NoteData, NoteVersionInfo, Tag, Topic, User,
} from "./types";

export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: FieldErrors = {},
  ) {
    super(message);
  }
}

/** Chuẩn hoá `fields` của lỗi 422 (object hoặc mảng) thành {tênTrường: thông báo}. */
function normalizeFields(raw: unknown): FieldErrors {
  const out: FieldErrors = {};
  if (Array.isArray(raw)) {
    for (const f of raw) {
      if (f && typeof f === "object") {
        const o = f as { field?: string; path?: string; message?: string };
        const k = o.field ?? o.path;
        if (k) out[k] = o.message ?? "Giá trị không hợp lệ";
      }
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      out[k] = Array.isArray(v) ? String(v[0]) : typeof v === "string" ? v : "Giá trị không hợp lệ";
    }
  }
  return out;
}

type Redirect = (to: "login" | "change-password") => void;
let redirect: Redirect = (to) => {
  if (typeof window === "undefined") return;
  const here = window.location.pathname + window.location.search;
  window.location.assign(to === "login" ? `/login?next=${encodeURIComponent(here)}` : "/change-password");
};
/** Cho phép AuthRedirector dùng router của Next thay vì tải lại trang. */
export function setAuthRedirect(fn: Redirect | null) {
  redirect = fn ?? redirect;
}

/** Hook để bản mock đổi địa chỉ tệp (blob:) khi chạy không có API. */
export const hooks = {
  fileUrl: (id: string) => `/api/files/${encodeURIComponent(id)}`,
};
export const fileUrl = (id: string) => hooks.fileUrl(id);

interface ReqOpts {
  method?: string;
  body?: unknown;
  form?: FormData;
  /** không tự chuyển hướng khi 401 (dùng cho đăng nhập) */
  noRedirect?: boolean;
  raw?: boolean;
}

async function request<T>(path: string, opts: ReqOpts = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? "GET", credentials: "same-origin", headers: {} };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, "network", "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.");
  }
  if (!res.ok) {
    let code = "error";
    let message = `Lỗi ${res.status}`;
    let fields: FieldErrors = {};
    try {
      const j = await res.json();
      code = j?.error?.code ?? code;
      message = j?.error?.message ?? message;
      fields = normalizeFields(j?.error?.fields);
    } catch { /* thân không phải JSON */ }
    if (!opts.noRedirect) {
      if (res.status === 401) redirect("login");
      else if (res.status === 403 && code === "must_change_password") redirect("change-password");
    }
    throw new ApiError(res.status, code, message, fields);
  }
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "" || v === false) continue;
    sp.set(k, v === true ? "1" : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const api = {
  // Auth
  login: (username: string, password: string) =>
    request<{ user: User }>("/auth/login", { method: "POST", body: { username, password }, noRedirect: true }),
  logout: () => request<void>("/auth/logout", { method: "POST", noRedirect: true }),
  me: (opts?: { noRedirect?: boolean }) => request<{ user: User }>("/auth/me", opts),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/auth/change-password", { method: "POST", body: { currentPassword, newPassword }, noRedirect: true }),

  // Topic
  topics: () => request<{ topics: Topic[] }>("/topics"),
  createTopic: (b: { name: string; parentId?: string | null; icon?: string }) =>
    request<Topic>("/topics", { method: "POST", body: b }),
  updateTopic: (id: string, b: { name?: string; icon?: string; parentId?: string | null }) =>
    request<Topic>(`/topics/${id}`, { method: "PATCH", body: b }),
  deleteTopic: (id: string) => request<void>(`/topics/${id}`, { method: "DELETE" }),
  reorderTopics: (parentId: string | null, ids: string[]) =>
    request<void>("/topics/reorder", { method: "POST", body: { parentId, ids } }),

  // Item
  items: (q: ItemQuery) =>
    request<{ items: Item[]; nextCursor: string | null }>(`/items${qs({ status: "active", ...q })}`),
  item: (id: string) => request<Item & { files?: FileInfo[] }>(`/items/${id}`),
  createItem: (b: ItemInput) => request<Item>("/items", { method: "POST", body: b }),
  updateItem: (id: string, b: ItemInput) => request<Item>(`/items/${id}`, { method: "PATCH", body: b }),
  archiveItem: (id: string) => request<void>(`/items/${id}`, { method: "DELETE" }),
  deleteItemHard: (id: string) => request<void>(`/items/${id}?hard=1`, { method: "DELETE" }),
  openItem: (id: string) => request<void>(`/items/${id}/open`, { method: "POST" }),
  reorderItems: (topicId: string | null, ids: string[]) =>
    request<void>("/items/reorder", { method: "POST", body: { topicId, ids } }),
  tags: () => request<{ tags: Tag[] }>("/tags"),
  search: (q: string) => request<{ items: Item[]; topics: Topic[] }>(`/search${qs({ q })}`),

  // File (API.md chưa nêu route liệt kê tệp: giả định GET /items/:id/files → {files})
  itemFiles: async (id: string): Promise<FileInfo[]> => {
    const r = await request<{ files: FileInfo[] }>(`/items/${id}/files`);
    return r.files;
  },
  uploadFiles: (itemId: string, files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append("file", f);
    return request<{ files: FileInfo[] }>(`/items/${itemId}/files`, { method: "POST", form });
  },
  deleteFile: (id: string) => request<void>(`/files/${id}`, { method: "DELETE" }),
  fileView: (id: string) => request<FileView>(`/files/${id}/view`),
  fileText: async (id: string): Promise<string> => {
    const res = await fetch(fileUrl(id), { credentials: "same-origin" });
    if (!res.ok) throw new ApiError(res.status, "error", "Không đọc được tệp.");
    return res.text();
  },

  // Note
  note: (id: string) => request<NoteData>(`/items/${id}/note`),
  saveNote: (id: string, markdown: string, baseVersion: number) =>
    request<{ version: number }>(`/items/${id}/note`, { method: "PUT", body: { markdown, baseVersion } }),
  noteVersions: (id: string) => request<{ versions: NoteVersionInfo[] }>(`/items/${id}/note/versions`),
  noteVersion: (id: string, v: number) =>
    request<{ version: number; markdown?: string; content?: string }>(`/items/${id}/note/versions/${v}`),
  restoreNote: (id: string, v: number) =>
    request<{ version?: number } | void>(`/items/${id}/note/versions/${v}/restore`, { method: "POST" }),
  exportNote: async (id: string): Promise<Blob> => {
    const res = await request<Response>(`/items/${id}/note/export?format=md`, { raw: true });
    return res.blob();
  },
};

export function messageOf(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Đã xảy ra lỗi.";
}
