"use client";
import { useEffect, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ApiError, api, messageOf } from "@/lib/api-client";
import { ICON_CHOICES } from "@/lib/format";
import { iconStateOf, type IconImageState } from "@/lib/icon-image";
import type { Topic } from "@/lib/types";
import { flatten, useShell } from "./AppShell";
import { ConfirmDialog } from "./Dialogs";
import { Icon } from "./icons/Icon";
import { IconView } from "./IconView";
import { IconPicker, commitIconImage } from "./IconPicker";
import { ItemForm } from "./ItemForm";
import { useToast } from "./Toast";

const findGroup = (tree: Topic[], parentId: string | null): Topic[] => flatten(tree).filter((t) => t.parentId === parentId);
function setGroup(tree: Topic[], parentId: string | null, ids: string[]): Topic[] {
  const sort = (g: Topic[]) => ids.map((id) => g.find((t) => t.id === id)!).filter(Boolean);
  if (parentId === null) return sort(tree);
  return tree.map((t) => (t.id === parentId ? { ...t, children: sort(t.children) } : { ...t, children: setGroup(t.children, parentId, ids) }));
}
const descendantIds = (t: Topic): string[] => [t.id, ...t.children.flatMap(descendantIds)];

export function TopicAdmin() {
  const shell = useShell();
  const toast = useToast();
  const [tree, setTree] = useState<Topic[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [del, setDel] = useState<Topic | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [nameErr, setNameErr] = useState("");
  const [live, setLive] = useState("");
  const [formKey, setFormKey] = useState(0);
  useEffect(() => { setTree(shell.topics); }, [shell.topics]);
  useEffect(() => { document.title = "Quản trị topic · Portal"; }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function reorder(parentId: string | null, ids: string[], moved?: string) {
    const before = tree;
    setTree((t) => setGroup(t, parentId, ids));
    try {
      await api.reorderTopics(parentId, ids);
      if (moved) {
        const nm = flatten(before).find((t) => t.id === moved)?.name ?? "";
        setLive(`Đã chuyển "${nm}" tới vị trí ${ids.indexOf(moved) + 1} trên ${ids.length}.`);
      }
      shell.refreshTopics();
    } catch (e) { setTree(before); toast.err(e); }
  }
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const all = flatten(tree);
    const a = all.find((t) => t.id === active.id);
    const o = all.find((t) => t.id === over.id);
    if (!a || !o || a.parentId !== o.parentId) { toast.err("Chỉ kéo được trong cùng một cấp. Dùng nút Sửa để đổi topic cha."); return; }
    const ids = findGroup(tree, a.parentId).map((t) => t.id);
    void reorder(a.parentId, arrayMove(ids, ids.indexOf(a.id), ids.indexOf(o.id)), a.id);
  }
  function step(t: Topic, dir: -1 | 1) {
    const ids = findGroup(tree, t.parentId).map((x) => x.id);
    const i = ids.indexOf(t.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    void reorder(t.parentId, arrayMove(ids, i, j), t.id);
  }

  async function add() {
    if (!name.trim()) { setNameErr("Nhập tên topic."); return; }
    setNameErr(""); setBusy(true);
    try {
      await api.createTopic({ name: name.trim(), parentId: parent || null });
      toast.ok(`Đã thêm topic "${name.trim()}".`);
      setName("");
      shell.refreshTopics();
    } catch (e) { if (e instanceof ApiError && e.status === 422) setNameErr(e.fields.name ?? e.message); else toast.err(e); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!del) return;
    setBusy(true);
    try {
      await api.deleteTopic(del.id);
      toast.ok(`Đã xoá topic "${del.name}".`);
      setDel(null);
      shell.refreshTopics();
    } catch (e) {
      setDel(null);
      toast.err(e instanceof ApiError && e.status === 409 ? "Topic còn mục hoặc topic con. Hãy chuyển hoặc xoá chúng trước." : e);
    } finally { setBusy(false); }
  }

  const flat = flatten(tree);
  return (
    <>
      <div className="ph"><h1>Quản trị</h1></div>
      <div className="adm">
        <section className="panel" aria-labelledby="tp-h">
          <h2 id="tp-h">Topic</h2>
          {!shell.topicsLoaded ? <div className="loading" style={{ padding: 14 }} role="status"><span className="spin" /> Đang tải…</div>
            : tree.length === 0 ? <p className="muted" style={{ padding: 14 }}>Chưa có topic nào. Thêm topic đầu tiên ở ô bên dưới.</p>
            : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}
                accessibility={{ screenReaderInstructions: { draggable: "Nhấn phím cách để nhấc topic, dùng phím mũi tên lên xuống để di chuyển, nhấn phím cách để thả, Esc để huỷ." } }}>
                <Group nodes={tree} depth={0} ctx={{ editing, setEditing, step, setDel, flat, onSaved: () => { setEditing(null); shell.refreshTopics(); }, toast, tree }} />
              </DndContext>
            )}
          <form className="addt" onSubmit={(e) => { e.preventDefault(); void add(); }}>
            <input aria-label="Tên topic mới" placeholder="Tên topic mới" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={nameErr ? true : undefined} aria-describedby={nameErr ? "tn-e" : undefined} />
            <select aria-label="Nằm trong" value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">Gốc</option>
              {flat.map((t) => <option key={t.id} value={t.id}>{"  ".repeat(t.depth)}{t.name}</option>)}
            </select>
            <button type="submit" className="btn pri" disabled={busy}>Thêm</button>
            {nameErr && <span id="tn-e" className="err" style={{ flexBasis: "100%" }}><Icon name="alert" size="s" />{nameErr}</span>}
          </form>
          <div className="sr" role="status" aria-live="polite">{live}</div>
        </section>
        <section className="panel" aria-labelledby="it-h">
          <h2 id="it-h">Thêm item</h2>
          <div className="pb"><ItemForm key={formKey} onSaved={() => { setFormKey((k) => k + 1); shell.bump(); }} /></div>
        </section>
      </div>
      {del && (
        <ConfirmDialog title={`Xoá topic "${del.name}"?`} message={del.itemCount > 0 || del.children.length > 0 ? "Topic này còn mục hoặc topic con nên máy chủ sẽ từ chối. Hãy chuyển chúng đi trước." : "Topic rỗng sẽ bị xoá vĩnh viễn."}
          confirmLabel="Xoá topic" danger busy={busy} onConfirm={remove} onCancel={() => setDel(null)} />
      )}
    </>
  );
}

interface Ctx {
  editing: string | null; setEditing: (id: string | null) => void;
  step: (t: Topic, d: -1 | 1) => void; setDel: (t: Topic) => void;
  flat: (Topic & { depth: number })[]; onSaved: () => void; toast: ReturnType<typeof useToast>; tree: Topic[];
}

function Group({ nodes, depth, ctx }: { nodes: Topic[]; depth: number; ctx: Ctx }) {
  return (
    <SortableContext items={nodes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
      {nodes.map((n, i) => <Node key={n.id} t={n} depth={depth} first={i === 0} last={i === nodes.length - 1} ctx={ctx} />)}
    </SortableContext>
  );
}

function Node({ t, depth, first, last, ctx }: { t: Topic; depth: number; first: boolean; last: boolean; ctx: Ctx }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: t.id });
  const cls = `trow ${depth ? `d${Math.min(depth, 2)}` : ""} ${isDragging ? "dragging" : ""}`;
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition, position: "relative", zIndex: isDragging ? 5 : undefined }}>
      {ctx.editing === t.id ? (
        <EditRow t={t} ctx={ctx} />
      ) : (
        <div className={cls}>
          <button type="button" ref={setActivatorNodeRef} className="dr" aria-label={`Kéo để đổi thứ tự ${t.name}`} {...attributes} {...listeners}><Icon name="drag" size="s" /></button>
          <span className="nm"><b><IconView name={t.icon || "folder"} imageUrl={t.iconImageUrl} px={24} className="tri" />{t.name}</b><small>{t.itemCount} mục{t.parentId ? `, nằm trong ${ctx.flat.find((x) => x.id === t.parentId)?.name ?? ""}` : ""}</small></span>
          <span className="ord">
            <button type="button" className="ibtn" aria-label={`Chuyển ${t.name} lên`} aria-disabled={first} style={first ? { opacity: .35 } : undefined} onClick={() => ctx.step(t, -1)}><Icon name="up" size="s" /></button>
            <button type="button" className="ibtn" aria-label={`Chuyển ${t.name} xuống`} aria-disabled={last} style={last ? { opacity: .35 } : undefined} onClick={() => ctx.step(t, 1)}><Icon name="down" size="s" /></button>
          </span>
          <span className="ops">
            <button type="button" className="ibtn" aria-label={`Sửa ${t.name}`} onClick={() => ctx.setEditing(t.id)}><Icon name="edit" size="s" /></button>
            <button type="button" className="ibtn" aria-label={`Xoá ${t.name}`} onClick={() => ctx.setDel(t)}><Icon name="trash" size="s" /></button>
          </span>
        </div>
      )}
      {t.children.length > 0 && <Group nodes={t.children} depth={depth + 1} ctx={ctx} />}
    </div>
  );
}

function EditRow({ t, ctx }: { t: Topic; ctx: Ctx }) {
  const [name, setName] = useState(t.name);
  const [parent, setParent] = useState(t.parentId ?? "");
  const [preset, setPreset] = useState(t.icon ?? "");
  const [img, setImg] = useState<IconImageState>(() => iconStateOf(t.iconImageUrl));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const banned = new Set(descendantIds(t));
  async function save() {
    if (!name.trim()) { setErr("Nhập tên topic."); return; }
    setBusy(true);
    try {
      await api.updateTopic(t.id, { name: name.trim(), parentId: parent || null, icon: preset });
      try { await commitIconImage("topic", t.id, img, !!t.iconImageUrl); }
      catch (e) { ctx.toast.err(`Đã lưu topic nhưng chưa đổi được ảnh biểu tượng: ${messageOf(e)}`); }
      ctx.toast.ok("Đã lưu topic.");
      ctx.onSaved();
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 409 ? "Không thể chuyển topic vào chính nó hoặc topic con của nó." : e instanceof ApiError && e.fields.name ? e.fields.name : messageOf(e));
    } finally { setBusy(false); }
  }
  return (
    <form className="trow edit" onSubmit={(e) => { e.preventDefault(); void save(); }} onKeyDown={(e) => { if (e.key === "Escape") ctx.setEditing(null); }}>
      <div className="two">
        <label className="fld">Tên<input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-invalid={err ? true : undefined} /></label>
        <label className="fld">Nằm trong
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">Gốc</option>
            {ctx.flat.filter((x) => !banned.has(x.id)).map((x) => <option key={x.id} value={x.id}>{"  ".repeat(x.depth)}{x.name}</option>)}
          </select>
        </label>
      </div>
      <IconPicker preset={preset} onPreset={setPreset} presets={ICON_CHOICES} defaultLabel="Thư mục (mặc định)" fallbackName="folder" image={img} onImage={setImg} />
      {err && <span className="err" role="alert"><Icon name="alert" size="s" />{err}</span>}
      <div className="acts"><button type="button" className="btn sm" onClick={() => ctx.setEditing(null)}>Huỷ</button><button type="submit" className="btn sm pri" disabled={busy}>Lưu</button></div>
    </form>
  );
}
