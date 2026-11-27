"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, fileUrl, messageOf } from "@/lib/api-client";
import { fileIcon, fileKind, formatSize, hostOf, iconOf, safeUrl } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import type { FileInfo, FileView } from "@/lib/types";
import { useShell } from "./AppShell";
import { ConfirmDialog } from "./Dialogs";
import { Icon } from "./icons/Icon";
import { IconView } from "./IconView";
import { Markdown } from "./Markdown";
import { useToast } from "./Toast";

export function ItemDetail({ id }: { id: string }) {
  const router = useRouter();
  const shell = useShell();
  const toast = useToast();
  const item = useAsync(async () => {
    const it = await api.item(id);
    const files = it.files ?? (it.fileCount > 0 || it.type === "doc" ? await api.itemFiles(id) : []);
    return { it, files };
  }, [id, shell.rev]);
  const [sel, setSel] = useState<string | null>(null);
  const [del, setDel] = useState<FileInfo | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const it = item.data?.it;
  const files = useMemo(() => item.data?.files ?? [], [item.data]);
  const topic = shell.flat.find((t) => t.id === it?.topicId);
  const file = files.find((f) => f.id === sel) ?? files[0];

  useEffect(() => { if (it?.type === "note") router.replace(`/notes/${id}`); }, [it, id, router]);
  useEffect(() => { if (it) document.title = `${it.title} · Portal`; }, [it]);

  async function upload(l: FileList | File[]) {
    const arr = Array.from(l);
    if (!arr.length) return;
    setBusy(true);
    try {
      const r = await api.uploadFiles(id, arr);
      toast.ok(`Đã tải lên ${r.files.length} tệp.`);
      await item.reload(true);
      shell.bump();
      if (r.files[0]) setSel(r.files[0].id);
    } catch (e) { toast.err(e); } finally { setBusy(false); }
  }
  async function remove() {
    if (!del) return;
    setBusy(true);
    try {
      await api.deleteFile(del.id);
      toast.ok(`Đã xoá "${del.originalName}".`);
      setDel(null);
      if (sel === del.id) setSel(null);
      await item.reload(true);
    } catch (e) { toast.err(e); } finally { setBusy(false); }
  }

  if (item.error) {
    return <div className="empty" role="alert"><Icon name="alert" size="l" /><h3>Không mở được mục này</h3><p>{messageOf(item.error)}</p><Link className="btn" href="/">Về trang chủ</Link></div>;
  }
  if (!it) return <div className="loading" role="status"><span className="spin" /> Đang tải…</div>;
  if (it.type === "note") return <div className="loading" role="status"><span className="spin" /> Đang mở ghi chú…</div>;

  const url = safeUrl(it.url);
  return (
    <>
      <nav className="bc" aria-label="Đường dẫn">
        <Link href="/">Tất cả</Link> /
        {topic && <><Link href={`/topic/${topic.id}`}>{topic.name}</Link> /</>}
        <b style={{ color: "var(--fg)" }}>{it.title}</b>
      </nav>
      <div className="ph">
        <span className={`ico ${it.iconImageUrl ? "has-img" : ""}`} style={{ width: 44, height: 44 }}><IconView name={iconOf(it)} imageUrl={it.iconImageUrl} px={44} /></span>
        <h1>{it.title}</h1>
        <button type="button" className="btn" onClick={() => shell.openPanel({ item: it })}><Icon name="edit" size="s" /> Sửa</button>
      </div>
      {it.description && <p className="muted" style={{ marginBottom: 14 }}>{it.description}</p>}

      {it.type !== "doc" ? (
        <div className="panel"><div className="detail">
          <p>Mục này là {it.type === "tool" ? "tool" : "liên kết"}{url && <>, đích: <b>{hostOf(url)}</b></>}.</p>
          {url && <div><a className="btn pri" href={url} {...(/^\//.test(url) ? {} : { target: "_blank", rel: "noopener noreferrer" })} onClick={() => void api.openItem(id).catch(() => {})}><Icon name="external" size="s" /> Mở</a></div>}
        </div></div>
      ) : (
        <div className="docs">
          <div className="files"
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); void upload(e.dataTransfer.files); }}>
            <h2>Tệp trong mục ({files.length})</h2>
            <ul>
              {files.map((f) => {
                const k = fileKind(f.mime, f.originalName);
                return (
                  <li key={f.id} className="file" aria-current={f.id === file?.id ? "true" : undefined}>
                    <button type="button" className="sel-f" onClick={() => setSel(f.id)} aria-label={`Xem ${f.originalName}`}>
                      <Icon name={fileIcon(k)} />
                      <span className="n">{f.originalName}<small>{k === "other" ? "Tệp" : k.toUpperCase()}, {formatSize(f.size)}</small></span>
                    </button>
                    <button type="button" className="ibtn" aria-label={`Xoá ${f.originalName}`} title="Xoá tệp" onClick={() => setDel(f)}><Icon name="trash" size="s" /></button>
                  </li>
                );
              })}
            </ul>
            <div className="up-zone">
              <button type="button" className={`drop ${over ? "over" : ""}`} disabled={busy} onClick={() => input.current?.click()}>
                <Icon name="upload" /><span>{busy ? "Đang tải lên…" : "Kéo tệp vào đây hoặc bấm để tải lên"}</span>
              </button>
              <input ref={input} type="file" multiple hidden onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} />
            </div>
          </div>
          <div className="viewer">
            {file ? <FileViewer key={file.id} file={file} /> : (
              <div className="vscroll" style={{ display: "grid", placeItems: "center", textAlign: "center" }}>
                <div><Icon name="doc" size="l" /><p className="muted" style={{ marginTop: 8 }}>Mục này chưa có tệp. Kéo tệp vào danh sách bên trái để tải lên.</p></div>
              </div>
            )}
          </div>
        </div>
      )}
      {del && <ConfirmDialog title="Xoá tệp này?" message={`"${del.originalName}" sẽ bị xoá khỏi mục và không hoàn tác được.`} confirmLabel="Xoá tệp" danger busy={busy} onConfirm={remove} onCancel={() => setDel(null)} />}
    </>
  );
}

function FileViewer({ file }: { file: FileInfo }) {
  const kind = fileKind(file.mime, file.originalName);
  const href = fileUrl(file.id);
  return (
    <>
      <div className="vbar">
        <Icon name={fileIcon(kind)} />
        <b title={file.originalName}>{file.originalName}</b>
        <a className="btn sm" href={href} target="_blank" rel="noopener noreferrer"><Icon name="external" size="s" /> Mở tab mới</a>
        <a className="btn sm" href={href} download={file.originalName}><Icon name="download" size="s" /> Tải xuống</a>
      </div>
      {kind === "pdf" && <div className="vscroll flush"><iframe src={href} title={`Xem ${file.originalName}`} /></div>}
      {kind === "image" && <div className="vscroll"><img className="pic" src={href} alt={file.originalName} /></div>}
      {(kind === "docx" || kind === "xlsx") && <ConvertedView id={file.id} />}
      {kind === "text" && <TextView id={file.id} name={file.originalName} />}
      {kind === "other" && <div className="vscroll"><p className="muted">Không xem trước được định dạng này. Hãy tải xuống để mở.</p></div>}
    </>
  );
}

function ConvertedView({ id }: { id: string }) {
  const v = useAsync<FileView>(() => api.fileView(id), [id]);
  const [sheet, setSheet] = useState(0);
  if (v.error) return <div className="vscroll"><p className="err" role="alert"><Icon name="alert" size="s" />{messageOf(v.error)}</p></div>;
  if (!v.data) return <div className="vscroll"><div className="loading" role="status"><span className="spin" /> Đang chuyển đổi…</div></div>;
  if (v.data.kind === "html") {
    // HTML đã được máy chủ lọc bằng allowlist (docs/API.md).
    return <div className="vscroll"><div className="paper" dangerouslySetInnerHTML={{ __html: v.data.html }} /></div>;
  }
  const sheets = v.data.sheets;
  const s = sheets[Math.min(sheet, sheets.length - 1)];
  const cols = Math.max(0, ...s.rows.map((r) => r.length));
  const letter = (i: number) => { let n = i, o = ""; do { o = String.fromCharCode(65 + (n % 26)) + o; n = Math.floor(n / 26) - 1; } while (n >= 0); return o; };
  return (
    <div className="vscroll">
      <div className="sheetwrap" tabIndex={0} role="region" aria-label={`Bảng ${s.name}`}>
        <table className="sheet">
          <thead><tr><th className="rn" scope="col"><span className="sr">Dòng</span></th>{Array.from({ length: cols }, (_, i) => <th key={i} scope="col">{letter(i)}</th>)}</tr></thead>
          <tbody>
            {s.rows.map((r, ri) => (
              <tr key={ri}><th className="rn" scope="row">{ri + 1}</th>{Array.from({ length: cols }, (_, ci) => <td key={ci}>{r[ci] ?? ""}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.truncated && <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>Bảng quá lớn nên chỉ hiện phần đầu (tối đa 2000 dòng, 500 cột).</p>}
      <div className="stabs" role="tablist" aria-label="Trang tính">
        {sheets.map((x, i) => <button key={i} type="button" role="tab" aria-selected={i === sheet} onClick={() => setSheet(i)}>{x.name}</button>)}
      </div>
    </div>
  );
}

function TextView({ id, name }: { id: string; name: string }) {
  const t = useAsync(() => api.fileText(id), [id]);
  if (t.error) return <div className="vscroll"><p className="err" role="alert">{messageOf(t.error)}</p></div>;
  if (t.data == null) return <div className="vscroll"><div className="loading" role="status"><span className="spin" /> Đang tải…</div></div>;
  return <div className="vscroll">{name.toLowerCase().endsWith(".md") ? <Markdown source={t.data} /> : <pre className="textview">{t.data}</pre>}</div>;
}
