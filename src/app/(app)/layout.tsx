import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="loading" role="status" style={{ padding: 24 }}><span className="spin" /> Đang tải…</div>}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
