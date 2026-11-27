"use client";
import { useLayoutEffect, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { setAuthRedirect } from "@/lib/api-client";
import { ToastProvider } from "./Toast";

const MOCK = process.env.NEXT_PUBLIC_MOCK === "1";

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(!MOCK);
  useLayoutEffect(() => {
    setAuthRedirect((to) => {
      const here = window.location.pathname + window.location.search;
      if (to === "login") { if (!here.startsWith("/login")) router.replace(`/login?next=${encodeURIComponent(here)}`); }
      else if (!here.startsWith("/change-password")) router.replace("/change-password");
    });
    return () => setAuthRedirect(null);
  }, [router]);
  useEffect(() => {
    if (MOCK) {
      // Nhánh này bị loại khỏi bundle khi NEXT_PUBLIC_MOCK không bằng "1".
      void import("@/lib/mock").then((m) => m.installMock()).then(() => setReady(true));
    }
  }, []);
  if (!ready) return <div className="loading" role="status" style={{ padding: 24 }}><span className="spin" /> Đang khởi tạo dữ liệu mẫu…</div>;
  return <ToastProvider>{children}</ToastProvider>;
}
