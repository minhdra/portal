"use client";
import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { ApiError, api, messageOf } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import type { NoteVersionInfo } from "@/lib/types";
import { useShell } from "./AppShell";
import { ConfirmDialog } from "./Dialogs";
import { Icon } from "./icons/Icon";
import { Markdown } from "./Markdown";
import { useToast } from "./Toast";

type Tab = "ed" | "pv" | "hist";

export function NoteEditor({ id }: { id: string }) {
  const shell = useShell();
  const toast = useToast();
  const area = useRef<HTMLTextAreaElement>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const meta = useAsync(async () => {
    const [item, note] = await Promise.all([api.item(id), api.note(id)]);
    return { item, note };
  }, [id]);
  const versions = useAsync(() => api.noteVersions(id).then((r) => r.versions), [id]);

  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [base, setBase] = useState(0);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [tab, setTab] = useState<Tab>("ed");
  const [viewing, setViewing] = useState<{ version: number; markdown: string } | null>(null);
  const [restoreV, setRestoreV] = useState<number | null>(null);
  const dirty = text !== saved;
  const deferred = useDeferredValue(viewing ? viewing.markdown : text);

  // nạp lần đầu
  useEffect(() => {
    const d = meta.data;
    if (!d) return;
    setText(d.note.markdown); setSaved(d.note.markdown); setBase(d.note.version); setSavedAt(d.note.updatedAt);
    setTitle(d.item.title);
    document.title = `${d.item.title} · Portal`;
  }, [meta.data]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const save = useCallback(async (force = false) => {
    if (saving) return;
    setSaving(true);
    try {
      let b = base;
      if (force) b = (await api.note(id)).version;
      const r = await api.saveNote(id, text, b);
      setBase(r.version); setSaved(text); setSavedAt(new Date().toISOString()); setConflict(false); setViewing(null);
      toast.ok(`Đã lưu phiên bản ${r.version}.`);
      void versions.reload(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      else toast.err(e);
    } finally { setSaving(false); }
  }, [saving, base, id, text, toast, versions]);

  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (text !== saved) void saveRef.current(); } };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [text, saved]);

  async function loadLatest() {
    try {
      const n = await api.note(id);
      setText(n.markdown); setSaved(n.markdown); setBase(n.version); setSavedAt(n.updatedAt); setConflict(false); setViewing(null);
      void versions.reload(true);
    } catch (e) { toast.err(e); }
  }

  async function saveTitle() {
    const t = title.trim();
    const cur = meta.data?.item.title;
    if (!t) { setTitle(cur ?? ""); return; }
    if (t === cur) return;
    try { await api.updateItem(id, { title: t }); meta.data!.item.title = t; toast.ok("Đã đổi tiêu đề."); shell.bump(); document.title = `${t} · Portal`; }
    catch (e) { toast.err(e); setTitle(cur ?? ""); }
  }

  // ---- chèn Markdown tại con trỏ
  function edit(fn: (sel: string, before: string, after: string) => { text: string; from: number; to: number }) {
    const a = area.current;
    if (!a) return;
    const { selectionStart: s, selectionEnd: e } = a;
    const r = fn(text.slice(s, e), text.slice(0, s), text.slice(e));
    setText(r.text);
    requestAnimationFrame(() => { a.focus(); a.setSelectionRange(r.from, r.to); });
  }
  const wrap = (l: string, r: string, ph: string) => edit((sel, b, a) => {
    const mid = sel || ph;
    return { text: b + l + mid + r + a, from: b.length + l.length, to: b.length + l.length + mid.length };
  });
  const prefix = (p: string, ph: string) => edit((sel, b, a) => {
    const lead = b.length && !b.endsWith("\n") ? "\n" : "";
    const body = (sel || ph).split("\n").map((x) => p + x).join("\n");
    return { text: b + lead + body + a, from: b.length + lead.length, to: b.length + lead.length + body.length };
  });
  const insert = (s: string) => edit((_, b, a) => ({ text: b + s + a, from: b.length + s.length, to: b.length + s.length }));

  async function uploadImages(files: File[]) {
    for (const f of files) {
      try {
        const r = await api.uploadFiles(id, [f]);
        const info = r.files[0];
        if (info) insert(`![${info.originalName.replace(/[[\]]/g, "")}](/api/files/${info.id})\n`);
      } catch (e) { toast.err(e); }
    }
  }

  async function exportMd() {
    try {
      const blob = dirty ? new Blob([text], { type: "text/markdown" }) : await api.exportNote(id);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(title || "ghi-chu").replace(/[\\/:*?"<>|]+/g, "-")}.md`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { toast.err(e); }
  }

  async function view(v: number) {
    try {
      const r = await api.noteVersion(id, v);
      setViewing({ version: v, markdown: r.markdown ?? r.content ?? "" });
      setTab("pv");
    } catch (e) { toast.err(e); }
  }
  async function restore(v: number) {
    setRestoreV(null);
    try {
      await api.restoreNote(id, v);
      toast.ok(`Đã khôi phục từ phiên bản ${v} (tạo phiên bản mới).`);
      await loadLatest();
    } catch (e) { toast.err(e); }
  }

  if (meta.error) return <div className="empty" role="alert"><Icon name="alert" size="l" /><h3>Không mở được ghi chú</h3><p>{messageOf(meta.error)}</p><Link className="btn" href="/">Về trang chủ</Link></div>;
  if (!meta.data) return <div className="loading" role="status"><span className="spin" /> Đang tải…</div>;

  const topic = shell.flat.find((t) => t.id === meta.data!.item.topicId);
  const list: NoteVersionInfo[] = versions.data ?? [];

  return (
    <>
      <nav className="bc" aria-label="Đường dẫn">
        <Link href="/">Tất cả</Link> /
        {topic && <><Link href={`/topic/${topic.id}`}>{topic.name}</Link> /</>}
        <b style={{ color: "var(--fg)" }}>{title}</b>
      </nav>
      <div className="note" data-tab={tab}>
        <div className="ntop">
          <input aria-label="Tiêu đề ghi chú" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
          <span className="st" role="status" aria-live="polite">{dirty ? "Có thay đổi chưa lưu" : `Đã lưu${savedAt ? ` ${new Date(savedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}` : ""}, phiên bản ${base}`}</span>
          <button type="button" className="btn sm pri" disabled={!dirty || saving} onClick={() => void save()} aria-keyshortcuts="Control+S">{saving ? "Đang lưu…" : "Lưu phiên bản"}</button>
          <button type="button" className="btn sm" onClick={exportMd}>Xuất .md</button>
          <button type="button" className="btn sm" onClick={() => { setViewing(null); setTab("pv"); setTimeout(() => window.print(), 60); }}>Xuất PDF</button>
        </div>
        <div className="ntabs" role="tablist" aria-label="Khu vực ghi chú">
          {([["ed", "Soạn"], ["pv", "Xem trước"], ["hist", "Lịch sử"]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        <div className="ed">
          {conflict && (
            <div className="banner warn" role="alert">
              <span className="grow"><b>Xung đột phiên bản.</b> Ghi chú đã được lưu ở nơi khác với phiên bản mới hơn. Chọn cách xử lý để không mất nội dung.</span>
              <button type="button" className="btn sm" onClick={() => void loadLatest()}>Tải bản mới (bỏ thay đổi của tôi)</button>
              <button type="button" className="btn sm dng" onClick={() => void save(true)}>Ghi đè bằng bản của tôi</button>
            </div>
          )}
          <div className="mdbar" role="toolbar" aria-label="Định dạng">
            <button type="button" className="ibtn" aria-label="Tiêu đề" title="Tiêu đề" onClick={() => prefix("## ", "Tiêu đề")}><Icon name="heading" size="s" /></button>
            <button type="button" className="ibtn" aria-label="Đậm" title="Đậm" onClick={() => wrap("**", "**", "đậm")}><Icon name="bold" size="s" /></button>
            <button type="button" className="ibtn" aria-label="Liên kết" title="Liên kết" onClick={() => wrap("[", "](https://)", "văn bản")}><Icon name="link" size="s" /></button>
            <button type="button" className="ibtn" aria-label="Danh sách" title="Danh sách" onClick={() => prefix("- ", "mục")}><Icon name="list" size="s" /></button>
            <button type="button" className="ibtn" aria-label="Trích dẫn" title="Trích dẫn" onClick={() => prefix("> ", "trích dẫn")}><Icon name="quote" size="s" /></button>
            <button type="button" className="ibtn" aria-label="Khối mã" title="Khối mã" onClick={() => wrap("\n```\n", "\n```\n", "mã")}><Icon name="code" size="s" /></button>
            <button type="button" className="ibtn" aria-label="Bảng" title="Bảng" onClick={() => insert("\n| Cột 1 | Cột 2 |\n| --- | --- |\n| Ô 1 | Ô 2 |\n")}><Icon name="table" size="s" /></button>
            <button type="button" className="ibtn" aria-label="Chèn ảnh" title="Chèn ảnh (hoặc dán ảnh vào ô soạn)" onClick={() => imgInput.current?.click()}><Icon name="image" size="s" /></button>
            <input ref={imgInput} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) void uploadImages(Array.from(e.target.files)); e.target.value = ""; }} />
          </div>
          <textarea ref={area} className="src" aria-label="Nội dung Markdown" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
              if (imgs.length) { e.preventDefault(); void uploadImages(imgs); }
            }}
            onDrop={(e) => {
              const imgs = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
              if (imgs.length) { e.preventDefault(); void uploadImages(imgs); }
            }} />
        </div>
        <div className="pv" aria-label="Xem trước">
          {viewing && (
            <div className="banner" style={{ margin: "-14px -18px 12px" }}>
              <span className="grow">Đang xem phiên bản {viewing.version} (chỉ đọc).</span>
              <button type="button" className="btn sm" onClick={() => setRestoreV(viewing.version)}>Khôi phục</button>
              <button type="button" className="btn sm" onClick={() => setViewing(null)}>Về bản đang soạn</button>
            </div>
          )}
          <Markdown source={deferred} />
        </div>
        <section className="hist" aria-label="Lịch sử phiên bản">
          <div className="hh">Lịch sử phiên bản<span className="tag">{list.length}</span></div>
          {versions.error ? <p className="err" style={{ padding: 12 }}>{messageOf(versions.error)}</p> : (
            <ol className="vers">
              {list.map((v) => {
                const cur = v.version === base;
                return (
                  <li key={v.version} className={cur ? "cur" : undefined} aria-current={cur ? "true" : undefined}>
                    <b>v{v.version}{cur ? " · Hiện tại" : ""}</b>
                    <span className="w">{formatDateTime(v.createdAt)}{v.author ? `, ${v.author}` : ""}</span>
                    <span className="a">
                      {viewing?.version === v.version ? <span className="tag">Đang xem</span> : <button type="button" className="btn sm" onClick={() => void view(v.version)}>Xem</button>}
                      {!cur && <button type="button" className="btn sm" onClick={() => (dirty ? setRestoreV(v.version) : void restore(v.version))}>Khôi phục</button>}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
      {restoreV != null && (
        <ConfirmDialog title={`Khôi phục phiên bản ${restoreV}?`} message={dirty ? "Các thay đổi chưa lưu trong ô soạn sẽ bị thay bằng nội dung phiên bản này (tạo thành phiên bản mới)." : "Nội dung phiên bản này sẽ thành phiên bản mới nhất."}
          confirmLabel="Khôi phục" onConfirm={() => void restore(restoreV)} onCancel={() => setRestoreV(null)} />
      )}
    </>
  );
}
