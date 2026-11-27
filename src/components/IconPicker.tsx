"use client";
import { useId, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { ICON_ACCEPT, IconError, prepareIcon, type IconImageState } from "@/lib/icon-image";
import { Icon } from "./icons/Icon";
import { IconView } from "./IconView";

interface Props {
  /** Biểu tượng vẽ sẵn đang chọn ("" = mặc định). */
  preset: string;
  onPreset: (v: string) => void;
  presets: [string, string][];
  /** Nhãn của lựa chọn "" (vd. "Theo loại"). */
  defaultLabel: string;
  /** Tên icon dùng để xem trước khi chưa chọn gì (icon mặc định). */
  fallbackName: string;
  image: IconImageState;
  onImage: (s: IconImageState) => void;
}

/** Mục "Biểu tượng": icon vẽ sẵn HOẶC tải ảnh riêng (chọn tệp, kéo thả, dán). Ảnh được thu nhỏ 128x128 PNG ngay ở trình duyệt. */
export function IconPicker({ preset, onPreset, presets, defaultLabel, fallbackName, image, onImage }: Props) {
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [live, setLive] = useState("");

  async function take(files: FileList | File[] | null | undefined) {
    const f = files && Array.from(files).find((x) => x.type.startsWith("image/"));
    if (!f) { setErr("Hãy chọn một tệp ảnh (PNG, JPEG, WebP hoặc GIF)."); return; }
    setErr(""); setBusy(true);
    try {
      const p = await prepareIcon(f);
      onImage({ url: p.dataUrl, blob: p.blob, dirty: true });
      setLive("Đã chọn ảnh làm biểu tượng. Bấm Lưu để áp dụng.");
    } catch (e) {
      setErr(e instanceof IconError ? e.message : "Không xử lý được ảnh.");
    } finally { setBusy(false); }
  }
  function reset() {
    onPreset("");
    if (image.url) onImage({ url: null, blob: null, dirty: true });
    setErr("");
    setLive("Đã chuyển về biểu tượng mặc định. Bấm Lưu để áp dụng.");
  }
  function pickPreset(v: string) {
    onPreset(v);
    // Ảnh và icon vẽ sẵn loại trừ nhau: chọn icon vẽ sẵn nghĩa là bỏ ảnh.
    if (image.url) { onImage({ url: null, blob: null, dirty: true }); setLive("Đã bỏ ảnh, dùng biểu tượng vẽ sẵn. Bấm Lưu để áp dụng."); }
  }

  return (
    <fieldset className="fld iconpick" aria-describedby={`${uid}-h`}
      onPaste={(e) => {
        const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith("image/"));
        if (f) { e.preventDefault(); void take([f]); }
      }}>
      <legend>Biểu tượng</legend>
      <div className="ip-row">
        <span className={`ico ip-prev ${image.url ? "has-img" : ""}`} aria-hidden="true"><IconView name={preset || fallbackName} imageUrl={image.url} px={48} /></span>
        <label className="fld ip-sel">Biểu tượng vẽ sẵn
          <select value={preset} onChange={(e) => pickPreset(e.target.value)}>
            <option value="">{defaultLabel}</option>
            {presets.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <button type="button" className={`drop ${over ? "over" : ""}`} disabled={busy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void take(e.dataTransfer.files); }}>
        <Icon name="upload" /><span>{busy ? "Đang xử lý ảnh…" : "Tải ảnh lên: bấm để chọn, kéo thả vào đây, hoặc dán (Ctrl+V) khi đang chọn ô này"}</span>
      </button>
      <input ref={input} type="file" accept={ICON_ACCEPT} hidden tabIndex={-1} onChange={(e) => { void take(e.target.files); e.target.value = ""; }} />
      <span className="h" id={`${uid}-h`}>PNG, JPEG, WebP hoặc GIF. Ảnh được cắt giữa thành hình vuông và thu nhỏ còn 128×128 trước khi tải lên.</span>
      {image.url && <div><button type="button" className="btn sm" onClick={reset}><Icon name="close" size="s" /> Dùng icon mặc định</button></div>}
      {err && <span className="err" role="alert"><Icon name="alert" size="s" />{err}</span>}
      <div className="sr" role="status" aria-live="polite">{live}</div>
    </fieldset>
  );
}

/** Gửi thay đổi ảnh lên sau khi item/topic đã lưu. `had`: trước khi sửa đã có ảnh trên máy chủ. */
export async function commitIconImage(kind: "item" | "topic", id: string, st: IconImageState, had: boolean): Promise<void> {
  if (!st.dirty) return;
  if (st.blob) await (kind === "item" ? api.setItemIcon(id, st.blob) : api.setTopicIcon(id, st.blob));
  else if (had) await (kind === "item" ? api.clearItemIcon(id) : api.clearTopicIcon(id));
}
