"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, messageOf } from "@/lib/api-client";
import { useAsync } from "@/lib/hooks";
import type { Item, Topic } from "@/lib/types";
import { useShell } from "./AppShell";
import { ConfirmDialog } from "./Dialogs";
import { Icon, Illustration } from "./icons/Icon";
import { ItemCard } from "./ItemCard";
import { useToast } from "./Toast";

const TYPES: [string, string][] = [["", "Tất cả"], ["tool", "Tool"], ["web", "Web"], ["doc", "Tài liệu"], ["note", "Ghi chú"], ["link", "Link"]];
const VIEW_TITLE: Record<string, string> = { pinned: "Ghim", recent: "Gần đây", archived: "Đã lưu trữ" };

interface Page { items: Item[]; nextCursor: string | null; topics: Topic[] }

export function ItemsView({ topicId }: { topicId?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const shell = useShell();
  const toast = useToast();
  const q = sp.get("q") ?? "";
  const type = sp.get("type") ?? "";
  const tag = sp.get("tag") ?? "";
  const view = sp.get("view") ?? "";
  const [confirm, setConfirm] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);

  const topic = topicId ? shell.flat.find((t) => t.id === topicId) : undefined;
  const topicName = useMemo(() => new Map(shell.flat.map((t) => [t.id, t.name])), [shell.flat]);

  const list = useAsync<Page>(async () => {
    if (!topicId && q) {
      const r = await api.search(q);
      const items = r.items.filter((i) => (!type || i.type === type) && (!tag || i.tags.some((t) => t.slug === tag)));
      return { items, nextCursor: null, topics: r.topics };
    }
    const r = await api.items({
      topic: topicId, q: q || undefined, type: type || undefined, tag: tag || undefined,
      pinned: view === "pinned", recent: view === "recent", status: view === "archived" ? "archived" : "active", limit: 50,
    });
    return { items: r.items, nextCursor: r.nextCursor, topics: [] };
  }, [topicId, q, type, tag, view, shell.rev]);
  const tags = useAsync(() => api.tags(), [shell.rev]);

  const items = useMemo(() => {
    const l = list.data?.items ?? [];
    // Ghim lên đầu (giữ thứ tự gốc trong mỗi nhóm), trừ khi đang xem "Gần đây".
    return view === "recent" ? l : [...l.filter((i) => i.pinned), ...l.filter((i) => !i.pinned)];
  }, [list.data, view]);

  const title = topicId ? (topic?.name ?? "Topic") : q ? `Kết quả cho "${q}"` : (VIEW_TITLE[view] ?? "Tất cả");
  useEffect(() => { document.title = `${title} · Portal`; }, [title]);

  function setParam(k: string, v: string) {
    const n = new URLSearchParams(sp.toString());
    if (v) n.set(k, v); else n.delete(k);
    const s = n.toString();
    router.replace(s ? `${pathname}?${s}` : pathname);
  }

  function patchLocal(id: string, p: Partial<Item>) {
    list.setData((d) => d && { ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...p } : i)) });
  }
  async function pin(i: Item) {
    patchLocal(i.id, { pinned: !i.pinned });
    try { await api.updateItem(i.id, { pinned: !i.pinned }); }
    catch (e) { patchLocal(i.id, { pinned: i.pinned }); toast.err(e); }
  }
  async function restore(i: Item) {
    try {
      await api.updateItem(i.id, { status: "active" });
      toast.ok(`Đã khôi phục "${i.title}".`);
      shell.bump();
    } catch (e) { toast.err(e); }
  }
  async function archive() {
    const i = confirm;
    if (!i) return;
    setBusy(true);
    try {
      await api.archiveItem(i.id);
      setConfirm(null);
      list.setData((d) => d && { ...d, items: d.items.filter((x) => x.id !== i.id) });
      shell.bump();
      toast.ok(`Đã lưu trữ "${i.title}".`, { label: "Hoàn tác", run: () => void restore(i) });
    } catch (e) { toast.err(e); } finally { setBusy(false); }
  }
  async function more() {
    const c = list.data?.nextCursor;
    if (!c) return;
    setMoreBusy(true);
    try {
      const r = await api.items({ topic: topicId, q: q || undefined, type: type || undefined, tag: tag || undefined, status: view === "archived" ? "archived" : "active", limit: 50, cursor: c });
      list.setData((d) => d && { ...d, items: [...d.items, ...r.items], nextCursor: r.nextCursor });
    } catch (e) { toast.err(e); } finally { setMoreBusy(false); }
  }

  const add = () => shell.openPanel({ topicId: topicId ?? null });
  const filtered = !!(type || tag);
  const noTopics = shell.topicsLoaded && shell.topics.length === 0 && !topicId && !q && !view && list.data != null && list.data.items.length === 0;
  const topicMissing = !!topicId && shell.topicsLoaded && !topic;

  return (
    <>
      {topic && topic.parentId && (
        <nav className="bc" aria-label="Đường dẫn">
          <Link href="/">Tất cả</Link> / <span style={{ color: "var(--fg)" }}>{topic.name}</span>
        </nav>
      )}
      <div className="ph">
        <h1>{title}</h1>
        {list.data && <span className="muted" aria-live="polite">{items.length}{list.data.nextCursor ? "+" : ""} mục</span>}
        {view !== "archived" && !topicMissing && <button type="button" className="btn pri" onClick={add}><Icon name="plus" size="s" /> Thêm item</button>}
      </div>

      {!noTopics && !topicMissing && (
        <>
          <div className="fl" role="group" aria-label="Lọc theo loại">
            {TYPES.map(([v, l]) => (
              <button key={v} type="button" className="chip" aria-pressed={type === v} onClick={() => setParam("type", v)}>{l}</button>
            ))}
          </div>
          {(tags.data?.tags.length ?? 0) > 0 && (
            <div className="fl tags" role="group" aria-label="Lọc theo thẻ">
              {tags.data!.tags.slice(0, 14).map((t) => (
                <button key={t.id} type="button" className="chip" aria-pressed={tag === t.slug} onClick={() => setParam("tag", tag === t.slug ? "" : t.slug)}>
                  {t.name}{t.count != null && <span className="muted">{t.count}</span>}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {(list.data?.topics.length ?? 0) > 0 && (
        <div className="fl" role="group" aria-label="Topic khớp">
          <span className="muted" style={{ alignSelf: "center" }}>Topic khớp:</span>
          {list.data!.topics.map((t) => <Link key={t.id} href={`/topic/${t.id}`} className="chip"><Icon name="folder" size="s" />{t.name}</Link>)}
        </div>
      )}

      {list.error ? (
        <div className="empty" role="alert">
          <Icon name="alert" size="l" /><h3>Không tải được danh sách</h3><p>{messageOf(list.error)}</p>
          <button type="button" className="btn" onClick={() => void list.reload()}>Thử lại</button>
        </div>
      ) : topicMissing ? (
        <Empty ill="empty-not-found" title="Không tìm thấy topic" text="Topic này không còn tồn tại hoặc đã bị xoá.">
          <Link className="btn" href="/">Về trang chủ</Link>
        </Empty>
      ) : noTopics ? (
        <Empty ill="empty-no-topic" title="Chưa có topic nào" text="Tạo topic đầu tiên để gom tool, web và tài liệu theo nhóm.">
          <Link className="btn pri" href="/admin/topics"><Icon name="plus" size="s" /> Tạo topic</Link>
        </Empty>
      ) : list.loading && !list.data ? (
        <div className="loading" role="status"><span className="spin" /> Đang tải…</div>
      ) : items.length === 0 ? (
        q ? (
          <Empty ill="empty-not-found" title="Không tìm thấy kết quả" text={`Không có mục nào khớp với "${q}". Thử từ khoá ngắn hơn.`}>
            <button type="button" className="btn" onClick={() => setParam("q", "")}>Xoá tìm kiếm</button>
          </Empty>
        ) : filtered ? (
          <Empty ill="empty-not-found" title="Không có mục khớp bộ lọc" text="Thử bỏ bớt bộ lọc loại hoặc thẻ.">
            <button type="button" className="btn" onClick={() => router.replace(pathname + (view ? `?view=${view}` : ""))}>Bỏ bộ lọc</button>
          </Empty>
        ) : view ? (
          <Empty ill="empty-no-item" title={view === "pinned" ? "Chưa ghim mục nào" : view === "recent" ? "Chưa mở mục nào gần đây" : "Không có mục đã lưu trữ"}
            text={view === "pinned" ? "Bấm biểu tượng ngôi sao trên thẻ để ghim mục hay dùng." : view === "recent" ? "Các mục bạn mở sẽ hiện ở đây." : "Mục bị lưu trữ sẽ nằm ở đây và có thể khôi phục."} />
        ) : (
          <Empty ill="empty-no-item" title={topicId ? "Topic này chưa có mục nào" : "Chưa có mục nào"}
            text={topicId ? `Thêm tool, web hoặc tài liệu đầu tiên cho ${topic?.name ?? "topic này"}.` : "Thêm tool, web hoặc tài liệu đầu tiên."}>
            <button type="button" className="btn pri" onClick={add}><Icon name="plus" size="s" /> Thêm item</button>
          </Empty>
        )
      ) : (
        <>
          <div className="grid">
            {items.map((i) => (
              <ItemCard key={i.id} item={i} topicName={!topicId ? topicName.get(i.topicId ?? "") : undefined}
                onPin={pin} onEdit={(x) => shell.openPanel({ item: x })} onArchive={setConfirm} onRestore={restore} />
            ))}
            {topic && view !== "archived" && (
              <button type="button" className="card add" onClick={add}><Icon name="plus" /><span>Thêm item vào {topic.name}</span></button>
            )}
          </div>
          {list.data?.nextCursor && (
            <div className="more"><button type="button" className="btn" disabled={moreBusy} onClick={more}>{moreBusy ? "Đang tải…" : "Tải thêm"}</button></div>
          )}
        </>
      )}

      {confirm && (
        <ConfirmDialog title="Lưu trữ mục này?" message={`"${confirm.title}" sẽ được chuyển vào "Đã lưu trữ". Bạn có thể hoàn tác ngay sau đó hoặc khôi phục sau.`}
          confirmLabel="Lưu trữ" danger busy={busy} onConfirm={archive} onCancel={() => setConfirm(null)} />
      )}
    </>
  );
}

function Empty({ ill, title, text, children }: { ill: "empty-no-item" | "empty-no-topic" | "empty-not-found"; title: string; text: string; children?: React.ReactNode }) {
  return (
    <div className="empties">
      <div className="empty">
        <Illustration name={ill} />
        <h3>{title}</h3>
        <p>{text}</p>
        {children}
      </div>
    </div>
  );
}
