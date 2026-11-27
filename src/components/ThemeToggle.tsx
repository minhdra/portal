"use client";
import { useEffect, useState } from "react";
import { Icon } from "./icons/Icon";

export const THEME_SCRIPT = `try{var t=localStorage.getItem('portal-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setDark(t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);
  function toggle() {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("portal-theme", next); } catch { /* bỏ qua */ }
    setDark(!dark);
  }
  return (
    <button type="button" className={`ibtn ${className}`} onClick={toggle} aria-label={dark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"} title={dark ? "Giao diện sáng" : "Giao diện tối"}>
      <Icon name="theme" />
    </button>
  );
}
