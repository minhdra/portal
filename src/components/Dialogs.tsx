"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons/Icon";

function useModal(onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  // Phần tử đang giữ tiêu điểm khi mở hộp thoại, để trả tiêu điểm khi đóng.
  const [opener] = useState(() => (typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null));
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    // Không gọi d.close() ở cleanup: nó bắn sự kiện close và (với StrictMode) đóng nhầm hộp thoại.
    return () => { setTimeout(() => { if (opener?.isConnected && !document.querySelector("dialog[open]")) opener.focus(); }, 0); };
  }, [opener]);
  return {
    ref,
    onClose,
    onClick: (e: React.MouseEvent<HTMLDialogElement>) => { if (e.target === e.currentTarget) onClose(); },
  };
}

/** Hộp xác nhận dùng <dialog> modal: có bẫy tiêu điểm, Esc để huỷ. */
export function ConfirmDialog(props: {
  title: string; message: string; confirmLabel: string; danger?: boolean; busy?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  const m = useModal(props.onCancel);
  return (
    <dialog ref={m.ref} className="confirm" aria-labelledby="cf-t" aria-describedby="cf-d" onClose={m.onClose} onClick={m.onClick}>
      <h2 id="cf-t">{props.title}</h2>
      <p id="cf-d">{props.message}</p>
      <div className="acts">
        <button type="button" className="btn" onClick={props.onCancel} autoFocus>Huỷ</button>
        <button type="button" className={`btn pri ${props.danger ? "dng" : ""}`} style={props.danger ? { background: "var(--danger)", borderColor: "var(--danger)", color: "var(--on-danger)" } : undefined}
          disabled={props.busy} onClick={props.onConfirm}>{props.confirmLabel}</button>
      </div>
    </dialog>
  );
}

/** Panel trượt bên phải (form thêm/sửa item). */
export function SidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const m = useModal(onClose);
  return (
    <dialog ref={m.ref} className="sidep" aria-labelledby="sp-t" onClose={m.onClose} onClick={m.onClick}>
      <div className="sph">
        <h2 id="sp-t">{title}</h2>
        <button type="button" className="ibtn" aria-label="Đóng panel" onClick={onClose}><Icon name="close" /></button>
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </dialog>
  );
}
