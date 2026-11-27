import { ICON_PATHS, ILLUSTRATIONS } from "./paths";

export type IconName = string;

/** Biểu tượng SVG nhúng trực tiếp: stroke currentColor nên theo màu sáng/tối. */
export function Icon({ name, size, className = "" }: { name: IconName; size?: "s" | "l"; className?: string }) {
  const body = ICON_PATHS[name] ?? ICON_PATHS.link;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      className={`i ${size ?? ""} ${className}`.trim()} aria-hidden="true" focusable="false"
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}

export function Illustration({ name, className = "" }: { name: "empty-no-item" | "empty-no-topic" | "empty-not-found"; className?: string }) {
  const it = ILLUSTRATIONS[name];
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={it.vb} className={className} aria-hidden="true" focusable="false"
      dangerouslySetInnerHTML={{ __html: it.body }} />
  );
}

/** Logo ngang (assets/logo-horizontal.svg), màu theo --accent và --ink. */
export function Logo({ text = true, className }: { text?: boolean; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={text ? "0 0 220 64" : "0 0 64 64"} className={className} aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="var(--accent,#0d9488)" />
      <circle cx="20" cy="20" r="6" fill="var(--on-accent,#fff)" />
      <circle cx="44" cy="20" r="6" fill="var(--on-accent,#fff)" opacity=".7" />
      <circle cx="20" cy="44" r="6" fill="var(--on-accent,#fff)" opacity=".7" />
      <circle cx="44" cy="44" r="6" fill="var(--on-accent,#fff)" />
      <path d="M20 20L44 44" stroke="var(--on-accent,#fff)" strokeWidth="3" strokeLinecap="round" opacity=".6" />
      {text && (
        <text x="78" y="43" fontFamily="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" fontSize="34" fontWeight="700" letterSpacing="-.5" fill="var(--ink,#1f2937)">Portal</text>
      )}
    </svg>
  );
}
