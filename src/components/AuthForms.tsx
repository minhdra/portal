"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { ApiError, api, messageOf } from "@/lib/api-client";
import { sanitizeNext } from "@/lib/safe-next";
import { Icon, Illustration, Logo } from "./icons/Icon";
import { ThemeToggle } from "./ThemeToggle";

function Brand() {
  return (
    <div className="brand">
      <Logo text={false} className="ill" />
      <h2>Một nơi cho mọi tool</h2>
      <p>Mở nhanh tool, web và tài liệu theo topic.</p>
    </div>
  );
}
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <Brand />
      <div className="col"><span className="tt"><ThemeToggle /></span>{children}</div>
    </div>
  );
}

export function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const uid = useId();
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { document.title = "Đăng nhập · Portal"; }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!u.trim() || !p) { setErr("Nhập tên đăng nhập và mật khẩu."); return; }
    setBusy(true); setErr("");
    try {
      const r = await api.login(u.trim(), p);
      router.replace(r.user.mustChangePassword ? "/change-password" : sanitizeNext(sp.get("next"), location.origin));
    } catch (e2) {
      setErr(e2 instanceof ApiError && e2.status === 401 ? "Sai tên đăng nhập hoặc mật khẩu." : messageOf(e2));
      setBusy(false);
    }
  }
  return (
    <Shell>
      <div className="authc">
        <div className="logo-h"><Logo /></div>
        <h1>Đăng nhập</h1>
        <form className="form" onSubmit={submit} noValidate>
          <label className="fld">Tên đăng nhập<input name="username" autoComplete="username" autoFocus value={u} onChange={(e) => setU(e.target.value)} aria-invalid={err ? true : undefined} aria-describedby={err ? `${uid}-e` : undefined} /></label>
          <label className="fld">Mật khẩu<input name="password" type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} aria-invalid={err ? true : undefined} aria-describedby={err ? `${uid}-e` : undefined} /></label>
          <div id={`${uid}-e`} role="alert">{err && <div className="err"><Icon name="alert" size="s" />{err}</div>}</div>
          <button className="btn pri" type="submit" disabled={busy} style={{ justifyContent: "center" }}>{busy ? "Đang đăng nhập…" : "Đăng nhập"}</button>
        </form>
      </div>
    </Shell>
  );
}

export function ChangePasswordForm() {
  const router = useRouter();
  const uid = useId();
  const [cur, setCur] = useState("");
  const [n1, setN1] = useState("");
  const [n2, setN2] = useState("");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { document.title = "Đổi mật khẩu · Portal"; }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const x: Record<string, string> = {};
    if (!cur) x.currentPassword = "Nhập mật khẩu hiện tại.";
    if (n1.length < 10) x.newPassword = "Mật khẩu mới tối thiểu 10 ký tự.";
    else if (n1 === cur) x.newPassword = "Mật khẩu mới phải khác mật khẩu hiện tại.";
    if (n2 !== n1) x.confirm = "Hai lần nhập chưa khớp.";
    setErrs(x); setFormErr("");
    if (Object.keys(x).length) return;
    setBusy(true);
    try {
      await api.changePassword(cur, n1);
      router.replace("/");
    } catch (e2) {
      if (e2 instanceof ApiError && e2.status === 422 && Object.keys(e2.fields).length) setErrs(e2.fields);
      else if (e2 instanceof ApiError && e2.status === 401) router.replace("/login");
      else setFormErr(messageOf(e2));
      setBusy(false);
    }
  }
  const f = (k: string) => ({ "aria-invalid": errs[k] ? true : undefined, "aria-describedby": errs[k] ? `${uid}-${k}` : undefined });
  const fe = (k: string) => errs[k] ? <span className="err" id={`${uid}-${k}`}><Icon name="alert" size="s" />{errs[k]}</span> : null;
  return (
    <Shell>
      <div className="authc">
        <div className="logo-h"><Logo /></div>
        <h1>Đổi mật khẩu lần đầu</h1>
        <p className="muted" style={{ fontSize: 13.5 }}>Tài khoản quản trị vừa khởi tạo. Hãy đặt mật khẩu mới trước khi tiếp tục.</p>
        <form className="form" onSubmit={submit} noValidate>
          <label className="fld">Mật khẩu hiện tại<input type="password" autoComplete="current-password" autoFocus value={cur} onChange={(e) => setCur(e.target.value)} {...f("currentPassword")} />{fe("currentPassword")}</label>
          <label className="fld">Mật khẩu mới<input type="password" autoComplete="new-password" value={n1} onChange={(e) => setN1(e.target.value)} {...f("newPassword")} />{fe("newPassword")}</label>
          <label className="fld">Nhập lại mật khẩu mới<input type="password" autoComplete="new-password" value={n2} onChange={(e) => setN2(e.target.value)} {...f("confirm")} />{fe("confirm")}</label>
          <div className="rules"><span>Tối thiểu 10 ký tự</span><span>Khác mật khẩu khởi tạo</span></div>
          {formErr && <div className="err" role="alert"><Icon name="alert" size="s" />{formErr}</div>}
          <button className="btn pri" type="submit" disabled={busy} style={{ justifyContent: "center" }}>{busy ? "Đang đổi…" : "Đổi mật khẩu và vào portal"}</button>
        </form>
      </div>
    </Shell>
  );
}
