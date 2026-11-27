"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, messageOf } from "@/lib/api-client";
import type { Item, ItemType, Topic, User } from "@/lib/types";
import { useAsync } from "@/lib/hooks";
import { Icon, Logo } from "./icons/Icon";
import { ThemeToggle } from "./ThemeToggle";
import { SidePanel } from "./Dialogs";
import { ItemForm } from "./ItemForm";
import { useToast } from "./Toast";

export interface PanelRequest { item?: Item; topicId?: string | null; type?: ItemType }
interface Shell {
  user: User | null;
  topics: Topic[];
  flat: (Topic & { depth: number })[];
  topicsLoaded: boolean;
  refreshTopics: () => void;
  /** tăng mỗi khi item đổi, để danh sách tải lại */
  rev: number;
  bump: () => void;
  openPanel: (r: PanelRequest) => void;
}
const Ctx = createContext<Shell | null>(null);
export const useShell = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useShell ngoài AppShell");
  return c;
};

export function flatten(ts: Topic[], depth = 0): (Topic & { depth: number })[] {
  return ts.flatMap((t) => [{ ...t, depth }, ...flatten(t.children ?? [], depth + 1)]);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const toast = useToast();
  const [rev, setRev] = useState(0);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<PanelRequest | null>(null);
  const burger = useRef<HTMLButtonElement>(null);
  const side = useRef<HTMLElement>(null);

  const me = useAsync(() => api.me(), []);
  const tp = useAsync(() => api.topics(), []);
  const user = me.data?.user ?? null;

  useEffect(() => {
    if (user?.mustChangePassword) router.replace("/change-password");
  }, [user, router]);

  const topics = tp.data?.topics ?? [];
  const flat = useMemo(() => flatten(topics), [topics]);
  const shell = useMemo<Shell>(() => ({
    user, topics, flat, topicsLoaded: !!tp.data,
    refreshTopics: () => void tp.reload(true),
    rev, bump: () => { setRev((r) => r + 1); void tp.reload(true); },
    openPanel: setPanel,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [user, tp.data, rev]);

  // đóng ngăn kéo khi đổi trang
  const here = pathname + "?" + sp.toString();
  useEffect(() => { setOpen(false); }, [here]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); burger.current?.focus(); } };
    document.addEventListener("keydown", k);
    side.current?.querySelector<HTMLElement>("a,button")?.focus();
    return () => document.removeEventListener("keydown", k);
  }, [open]);

  const logout = useCallback(async () => {
    try { await api.logout(); } catch (e) { toast.err(messageOf(e)); return; }
    router.replace("/login");
  }, [router, toast]);

  if (me.error && !user) {
    return <div className="main" role="alert"><p className="err">{messageOf(me.error)}</p></div>;
  }

  const view = sp.get("view");
  const onHome = pathname === "/" && !sp.get("q");
  const cur = (ok: boolean) => (ok ? ("page" as const) : undefined);

  return (
    <Ctx.Provider value={shell}>
      <a className="skip" href="#main">Chuyển tới nội dung chính</a>
      <div className="app">
        <header className="hd">
          <button ref={burger} type="button" className="ibtn burger" aria-label="Mở danh sách topic" aria-expanded={open} aria-controls="side" onClick={() => setOpen(true)}>
            <Icon name="menu" />
          </button>
          <Link href="/" className="logo" aria-label="Portal, về trang chủ"><Logo text={false} /><span>Portal</span></Link>
          <SearchBox />
          <span className="me" title={user?.displayName}><Icon name="user" size="s" /><span>{user?.displayName ?? ""}</span></span>
          <ThemeToggle />
          <Link className="ibtn" href="/admin/topics" aria-label="Quản trị topic" title="Quản trị topic"><Icon name="settings" /></Link>
          <button type="button" className="ibtn" onClick={logout} aria-label="Đăng xuất" title="Đăng xuất"><Icon name="logout" /></button>
        </header>
        <div className={`scrim ${open ? "open" : ""}`} onClick={() => setOpen(false)} aria-hidden="true" />
        <aside ref={side} id="side" className={`side ${open ? "open" : ""}`} aria-label="Topic">
          <div className="sdh"><b>Topic</b><button type="button" className="ibtn" aria-label="Đóng danh sách topic" onClick={() => { setOpen(false); burger.current?.focus(); }}><Icon name="close" /></button></div>
          <nav className="topics" aria-label="Điều hướng topic">
            <Link className="tp" href="/" aria-current={cur(onHome && !view)}><Icon name="all" /><span className="t">Tất cả</span></Link>
            <Link className="tp" href="/?view=pinned" aria-current={cur(pathname === "/" && view === "pinned")}><Icon name="star" /><span className="t">Ghim</span></Link>
            <Link className="tp" href="/?view=recent" aria-current={cur(pathname === "/" && view === "recent")}><Icon name="clock" /><span className="t">Gần đây</span></Link>
            <h2 style={{ marginTop: 8 }}>Topic</h2>
            {!tp.data && <div className="loading" style={{ padding: "8px 10px" }}><span className="spin" /> Đang tải…</div>}
            {flat.map((t) => (
              <Link key={t.id} className={`tp ${t.depth ? `d${Math.min(t.depth, 2)}` : ""}`} href={`/topic/${t.id}`} aria-current={cur(pathname === `/topic/${t.id}`)}>
                <Icon name={t.icon && t.icon !== "" ? t.icon : "folder"} /><span className="t">{t.name}</span><span className="c" aria-label={`${t.itemCount} mục`}>{t.itemCount}</span>
              </Link>
            ))}
            <hr />
            <Link className="tp" href="/?view=archived" aria-current={cur(pathname === "/" && view === "archived")}><Icon name="archive" /><span className="t">Đã lưu trữ</span></Link>
            <Link className="tp" href="/admin/topics" aria-current={cur(pathname.startsWith("/admin"))}><Icon name="settings" /><span className="t">Quản trị topic</span></Link>
          </nav>
        </aside>
        <main id="main" className="main" tabIndex={-1}>{children}</main>
      </div>
      {panel && (
        <SidePanel title={panel.item ? "Sửa item" : "Thêm item"} onClose={() => setPanel(null)}>
          <ItemForm item={panel.item} defaultTopicId={panel.topicId} defaultType={panel.type}
            onCancel={() => setPanel(null)} onSaved={() => { setPanel(null); shell.bump(); }} />
        </SidePanel>
      )}
    </Ctx.Provider>
  );
}

function SearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const urlQ = sp.get("q") ?? "";
  const [v, setV] = useState(urlQ);
  const input = useRef<HTMLInputElement>(null);
  const last = useRef(urlQ);

  useEffect(() => { if (urlQ !== last.current) { last.current = urlQ; setV(urlQ); } }, [urlQ]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof Element && t.closest("input,textarea,select,[contenteditable=true],dialog")) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, []);

  function commit(q: string) {
    last.current = q;
    const base = pathname === "/" || pathname.startsWith("/topic/") ? pathname : "/";
    const next = new URLSearchParams(base === pathname ? sp.toString() : "");
    if (q) next.set("q", q); else next.delete("q");
    const s = next.toString();
    router.replace(s ? `${base}?${s}` : base);
  }
  useEffect(() => {
    if (v === last.current) return;
    const t = setTimeout(() => commit(v.trim()), 250);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);

  return (
    <form className="search" role="search" onSubmit={(e) => { e.preventDefault(); commit(v.trim()); }}>
      <Icon name="search" size="s" />
      <input ref={input} type="search" aria-label="Tìm kiếm" aria-keyshortcuts="/" placeholder="Tìm tool, web, tài liệu" value={v} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { setV(""); input.current?.blur(); } }} />
      <kbd aria-hidden="true">/</kbd>
    </form>
  );
}
