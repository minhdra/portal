"use client";
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, api, messageOf } from "@/lib/api-client";
import { ICON_CHOICES, TYPE_ICON, TYPE_LABEL, formatSize } from "@/lib/format";
import type { Item, ItemType } from "@/lib/types";
import { iconStateOf, type IconImageState } from "@/lib/icon-image";
import { useShell } from "./AppShell";
import { IconPicker, commitIconImage } from "./IconPicker";
import { Icon } from "./icons/Icon";
import { useToast } from "./Toast";

const TYPES: ItemType[] = ["tool", "web", "doc", "note", "link"];

interface Props {
  item?: Item;
  defaultTopicId?: string | null;
  defaultType?: ItemType;
  onCancel?: () => void;
  onSaved: (i: Item) => void;
}

export function ItemForm({ item, defaultTopicId, defaultType, onCancel, onSaved }: Props) {
  const shell = useShell();
  const toast = useToast();
  const router = useRouter();
  const uid = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<ItemType>(item?.type ?? defaultType ?? "tool");
  const [topicId, setTopicId] = useState(item?.topicId ?? defaultTopicId ?? "");
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [url, setUrl] = useState(item?.url ?? "");
  const [tags, setTags] = useState(item?.tags.map((t) => t.name).join(", ") ?? "");
  const [icon, setIcon] = useState(item?.icon ?? "");
  const [iconImg, setIconImg] = useState<IconImageState>(() => iconStateOf(item?.iconImageUrl));
  const [status, setStatus] = useState(item?.status ?? "active");
  const [pending, setPending] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState("");
  const [busy, setBusy] = useState(false);

  const needsUrl = type === "tool" || type === "web" || type === "link";
  const id = (k: string) => `${uid}-${k}`;
  const inv = (k: string) => ({ "aria-invalid": errors[k] ? true : undefined, "aria-describedby": errors[k] ? id(`${k}-e`) : undefined });
  const fe = (k: string) => errors[k] ? <span className="err" id={id(`${k}-e`)}><Icon name="alert" size="s" />{errors[k]}</span> : null;

  function addFiles(l: FileList | File[]) {
    const arr = Array.from(l);
    setPending((p) => [...p, ...arr.filter((f) => !p.some((x) => x.name === f.name && x.size === f.size))]);
  }

  async function submit(pin: boolean) {
    const errs: Record<string, string> = {};
    if (!title.trim()) errs.title = "Nhập tiêu đề.";
    if (needsUrl) {
      if (!url.trim()) errs.url = "Nhập địa chỉ đích.";
      else if (!/^(https?:\/\/\S+|\/(?!\/)\S*)$/.test(url.trim())) errs.url = "Địa chỉ phải bắt đầu bằng http://, https:// hoặc /.";
    }
    setErrors(errs);
    setFormErr("");
    if (Object.keys(errs).length) return;
    setBusy(true);
    const base = {
      type, title: title.trim(), description: description.trim(), url: needsUrl ? url.trim() : "", icon,
      topicId: topicId || null,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    };
    try {
      let saved: Item;
      if (item) {
        saved = await api.updateItem(item.id, { ...base, status, ...(pin ? { pinned: true } : {}) });
      } else {
        // Body tạo mới của API không nhận status/pinned (bị bỏ qua), nên gửi PATCH bổ sung.
        saved = await api.createItem(base);
        const extra = { ...(status !== "active" ? { status } : {}), ...(pin ? { pinned: true } : {}) };
        if (Object.keys(extra).length) {
          try { saved = await api.updateItem(saved.id, extra); }
          catch (e) { toast.err(`Đã thêm mục nhưng chưa đặt được ghim/trạng thái: ${messageOf(e)}`); }
        }
      }
      if (iconImg.dirty) {
        try {
          await commitIconImage("item", saved.id, iconImg, !!item?.iconImageUrl);
          saved = await api.item(saved.id);
        } catch (e) { toast.err(`Đã lưu mục nhưng chưa đổi được ảnh biểu tượng: ${messageOf(e)}`); }
      }
      if (pending.length) {
        try { await api.uploadFiles(saved.id, pending); }
        catch (e) { toast.err(`Đã lưu mục nhưng tải tệp lên lỗi: ${messageOf(e)}`); }
      }
      toast.ok(item ? "Đã lưu thay đổi." : "Đã thêm mục.");
      onSaved(saved);
      if (!item && saved.type === "note") router.push(`/notes/${saved.id}`);
      else if (!item && saved.type === "doc" && pending.length) router.push(`/items/${saved.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        setErrors(e.fields);
        const known = ["title", "description", "url", "tags", "file"];
        setFormErr(Object.keys(e.fields).some((k) => known.includes(k)) ? "" : (Object.values(e.fields)[0] ?? e.message));
      } else setFormErr(messageOf(e));
    } finally { setBusy(false); }
  }

  return (
    <form className="form" aria-label={item ? "Sửa item" : "Thêm item"} noValidate onSubmit={(e) => { e.preventDefault(); void submit(false); }}>
      <div className="two">
        <label className="fld">Loại
          <select value={type} onChange={(e) => setType(e.target.value as ItemType)} disabled={!!item && item.type === "note"}>
            {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="fld">Topic
          <select value={topicId} onChange={(e) => setTopicId(e.target.value)}>
            <option value="">Không có topic</option>
            {shell.flat.map((t) => <option key={t.id} value={t.id}>{"  ".repeat(t.depth)}{t.name}</option>)}
          </select>
        </label>
      </div>
      <label className="fld">Tiêu đề
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ví dụ: Công cụ mới" required {...inv("title")} />
        {fe("title")}
      </label>
      <label className="fld">Mô tả
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Mô tả ngắn một dòng" {...inv("description")} />
        {fe("description")}
      </label>
      {needsUrl && (
        <label className="fld">Địa chỉ đích <span className="h">Bấm thẻ sẽ mở địa chỉ này. Dạng https://… hoặc /đường-dẫn-nội-bộ</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://tool.example.local/" inputMode="url" autoComplete="off" {...inv("url")} />
          {fe("url")}
        </label>
      )}
      {type === "doc" && (
        <div className="fld">
          <span>Tệp đính kèm</span>
          <button type="button" className={`drop ${over ? "over" : ""}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}>
            <Icon name="upload" /><span>Hoặc kéo tệp vào đây để tải lên (PDF, DOCX, XLSX, ảnh), tối đa 50 MB mỗi tệp</span>
          </button>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
          {errors.file && <span className="err"><Icon name="alert" size="s" />{errors.file}</span>}
          {pending.length > 0 && (
            <ul className="pend" aria-label="Tệp sẽ tải lên">
              {pending.map((f, i) => (
                <li key={f.name + i}><Icon name="doc" size="s" /><span>{f.name} <small className="muted">{formatSize(f.size)}</small></span>
                  <button type="button" className="ibtn" style={{ width: 28, height: 28 }} aria-label={`Bỏ ${f.name}`} onClick={() => setPending((p) => p.filter((_, j) => j !== i))}><Icon name="close" size="s" /></button></li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="two">
        <label className="fld">Thẻ <span className="h">Cách nhau dấu phẩy</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Dữ liệu, Tệp" {...inv("tags")} />
          {fe("tags")}
        </label>
        <label className="fld">Trạng thái
          <select value={status} onChange={(e) => setStatus(e.target.value as Item["status"])}>
            <option value="active">Hiển thị</option>
            <option value="draft">Ẩn (nháp)</option>
            <option value="archived">Lưu trữ</option>
          </select>
        </label>
      </div>
      <IconPicker preset={icon} onPreset={setIcon} presets={ICON_CHOICES} defaultLabel="Theo loại" fallbackName={TYPE_ICON[type]} image={iconImg} onImage={setIconImg} />
      {formErr && <div className="err" role="alert"><Icon name="alert" size="s" />{formErr}</div>}
      <div className="acts">
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Huỷ</button>}
        {!item?.pinned && <button type="button" className="btn pri" disabled={busy} onClick={() => void submit(true)}><Icon name="star" size="s" /> Lưu và ghim</button>}
        <button type="submit" className="btn pri" disabled={busy}>{busy ? "Đang lưu…" : "Lưu"}</button>
      </div>
    </form>
  );
}
