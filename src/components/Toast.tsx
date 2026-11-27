"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Icon } from "./icons/Icon";
import { messageOf } from "@/lib/api-client";

interface ToastItem { id: number; kind: "ok" | "err"; text: string; action?: { label: string; run: () => void } }
interface ToastApi {
  ok: (text: string, action?: ToastItem["action"]) => void;
  err: (e: unknown) => void;
}
const Ctx = createContext<ToastApi>({ ok: () => {}, err: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<ToastItem[]>([]);
  const n = useRef(0);
  const drop = useCallback((id: number) => setList((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback((t: Omit<ToastItem, "id">, ms: number) => {
    const id = ++n.current;
    setList((l) => [...l.slice(-3), { ...t, id }]);
    setTimeout(() => drop(id), ms);
  }, [drop]);
  const api = useMemo<ToastApi>(() => ({
    ok: (text, action) => push({ kind: "ok", text, action }, action ? 9000 : 4500),
    err: (e) => push({ kind: "err", text: typeof e === "string" ? e : messageOf(e) }, 8000),
  }), [push]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts">
        <div role="status" aria-live="polite" style={{ display: "contents" }}>
          {list.filter((t) => t.kind === "ok").map((t) => <Row key={t.id} t={t} drop={drop} />)}
        </div>
        <div role="alert" style={{ display: "contents" }}>
          {list.filter((t) => t.kind === "err").map((t) => <Row key={t.id} t={t} drop={drop} />)}
        </div>
      </div>
    </Ctx.Provider>
  );
}

function Row({ t, drop }: { t: ToastItem; drop: (id: number) => void }) {
  return (
    <div className={`toast ${t.kind === "err" ? "err" : ""}`}>
      <Icon name={t.kind === "err" ? "alert" : "check"} size="s" />
      <span className="m">{t.text}</span>
      {t.action && <button type="button" onClick={() => { t.action!.run(); drop(t.id); }}>{t.action.label}</button>}
      <button type="button" className="x" aria-label="Đóng thông báo" onClick={() => drop(t.id)}><Icon name="close" size="s" /></button>
    </div>
  );
}
