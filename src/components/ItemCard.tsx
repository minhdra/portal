"use client";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { TYPE_LABEL, hostOf, iconOf, isInternal, safeUrl } from "@/lib/format";
import type { Item } from "@/lib/types";
import { Icon } from "./icons/Icon";
import { IconView } from "./IconView";

interface Props {
  item: Item;
  topicName?: string;
  onPin: (i: Item) => void;
  onEdit: (i: Item) => void;
  onArchive: (i: Item) => void;
  onRestore: (i: Item) => void;
}

export function ItemCard({ item, topicName, onPin, onEdit, onArchive, onRestore }: Props) {
  const url = safeUrl(item.url);
  const direct = (item.type === "tool" || item.type === "web" || item.type === "link") && url;
  const external = !!url && !isInternal(url);
  const ping = () => { void api.openItem(item.id).catch(() => {}); };
  const archived = item.status === "archived";

  const label = <>{item.title}{external && <span className="sr"> (mở trong tab mới)</span>}</>;
  let title: React.ReactNode;
  if (direct && external) {
    title = <a href={url} target="_blank" rel="noopener noreferrer" onClick={ping}>{label}</a>;
  } else if (direct) {
    // Địa chỉ nội bộ "/x": ghi nhận rồi mở cùng cửa sổ (đường dẫn có thể thuộc ứng dụng khác nên không dùng router).
    title = (
      <a href={url} onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) { ping(); return; }
        e.preventDefault();
        void Promise.race([api.openItem(item.id).catch(() => {}), new Promise((r) => setTimeout(r, 700))]).then(() => window.location.assign(url));
      }}>{label}</a>
    );
  } else {
    title = <Link href={item.type === "note" ? `/notes/${item.id}` : `/items/${item.id}`} onClick={ping}>{label}</Link>;
  }

  return (
    <article className="card" aria-label={item.title}>
      <div className="top">
        <span className={`ico ${item.iconImageUrl ? "has-img" : ""}`}><IconView name={iconOf(item)} imageUrl={item.iconImageUrl} px={40} /></span>
        <span className="kind" style={{ flex: 1, marginLeft: 8 }}>{TYPE_LABEL[item.type]}</span>
        <div className="acts2">
          {!archived && (
            <button type="button" className={`ibtn ${item.pinned ? "on" : ""}`} aria-pressed={item.pinned} aria-label={item.pinned ? `Bỏ ghim ${item.title}` : `Ghim ${item.title}`} title={item.pinned ? "Bỏ ghim" : "Ghim"} onClick={() => onPin(item)}>
              <Icon name="star" size="s" {...(item.pinned ? { className: "fill" } : {})} />
            </button>
          )}
          <button type="button" className="ibtn" aria-label={`Sửa ${item.title}`} title="Sửa" onClick={() => onEdit(item)}><Icon name="edit" size="s" /></button>
          {archived
            ? <button type="button" className="ibtn" aria-label={`Khôi phục ${item.title}`} title="Khôi phục" onClick={() => onRestore(item)}><Icon name="upload" size="s" /></button>
            : <button type="button" className="ibtn" aria-label={`Lưu trữ ${item.title}`} title="Lưu trữ" onClick={() => onArchive(item)}><Icon name="trash" size="s" /></button>}
        </div>
      </div>
      <h3>{title}</h3>
      {item.description && <p>{item.description}</p>}
      <div className="ft">
        {item.tags.slice(0, 3).map((t) => <span className="tag" key={t.id}>{t.name}</span>)}
        {url && <span className="dest">{hostOf(url)}</span>}
        {item.type === "doc" && <span>{item.fileCount} tệp</span>}
        {topicName && <span>{topicName}</span>}
      </div>
      <span className="go" aria-hidden="true"><Icon name={direct && external ? "external" : "chevron"} size="s" /></span>
    </article>
  );
}
