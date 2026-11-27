"use client";
import { useEffect, useState } from "react";
import { Icon } from "./icons/Icon";

/**
 * Biểu tượng của item/topic: ảnh tuỳ chọn nếu có, ngược lại icon tên (SVG vẽ sẵn). Ảnh chỉ để trang trí nên alt rỗng
 * (tên đã có ở chữ bên cạnh). Ảnh lỗi/mất -> rơi về icon tên.
 */
export function IconView({ name, imageUrl, px = 24, className = "" }: { name: string; imageUrl?: string | null; px?: number; className?: string }) {
  const [bad, setBad] = useState(false);
  useEffect(() => { setBad(false); }, [imageUrl]);
  if (imageUrl && !bad) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className={`iimg ${className}`.trim()} src={imageUrl} alt="" width={px} height={px} loading="lazy" decoding="async" onError={() => setBad(true)} />
    );
  }
  return <Icon name={name} className={className} />;
}
