import { useState } from "react";
import { buildShoppingList, fmt, guessCategory, keyOf, parseLine } from "../lib/merge";
import { errorText, supabase } from "../lib/supabase";
import type { ShoppingTemplate, TemplateItem } from "../lib/types";
import type { FamilyData } from "../lib/useFamily";

interface Props { data: FamilyData; userId: string; onClose: () => void; onAdded: (count: number) => void }

const label = (i: TemplateItem) => [i.qty != null ? fmt(i.qty) : "", i.unit, i.name].filter(Boolean).join(" ");

/** Faste varer: vælg en liste, fravælg det, I ikke mangler, og tilføj resten til indkøbslisten. */
export function Templates({ data, userId, onClose, onAdded }: Props) {
  const isParent = data.me?.role === "parent";
  const [openId, setOpenId] = useState<string | null>(data.templates.length === 1 ? data.templates[0].id : null);
  const [editing, setEditing] = useState<ShoppingTemplate | "new" | null>(null);
  const open = data.templates.find((t) => t.id === openId) ?? null;

  return (
    <div className="sheet" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>{editing ? (editing === "new" ? "Ny liste med faste varer" : `Ret ${editing.name}`) : open ? open.name : "Faste varer"}</h2>
          <button className="link" onClick={onClose}>Luk</button>
        </div>

        {editing ? (
          <TemplateEditor data={data} userId={userId} template={editing === "new" ? undefined : editing}
            onDone={(id) => { setEditing(null); if (id) setOpenId(id); }} />
        ) : open ? (
          <TemplatePicker key={open.id + ":" + open.items.length} data={data} userId={userId} template={open} isParent={isParent}
            onBack={data.templates.length > 1 ? () => setOpenId(null) : undefined}
            onEdit={() => setEditing(open)} onAdded={onAdded} />
        ) : (
          <div className="stack">
            {data.templates.length === 0 && (
              <p className="muted" style={{ margin: 0 }}>
                {isParent ? "Lav en liste med de ting, I altid køber, fx mælk, brød og kaffe. Så kan de lægges på indkøbslisten med ét tryk." : "Mor eller far har ikke lavet en liste med faste varer endnu."}
              </p>
            )}
            {data.templates.length > 0 && (
              <div className="list">
                {data.templates.map((t) => (
                  <div key={t.id} style={{ cursor: "pointer" }} onClick={() => setOpenId(t.id)}>
                    <span><b>{t.name}</b><br /><span className="muted small">{t.items.length} varer</span></span>
                    <span className="muted">›</span>
                  </div>
                ))}
              </div>
            )}
            {isParent && <div className="row"><button className="btn ghost" onClick={() => setEditing("new")}>Ny liste</button></div>}
          </div>
        )}
      </div>
    </div>
  );
}

function TemplatePicker({ data, userId, template, isParent, onBack, onEdit, onAdded }: {
  data: FamilyData; userId: string; template: ShoppingTemplate; isParent: boolean;
  onBack?: () => void; onEdit: () => void; onAdded: (count: number) => void;
}) {
  // Varer, der allerede står på listen, er fravalgt fra start.
  const onList = new Set(buildShoppingList(data.dishes, data.extras).map((i) => i.key));
  const [chosen, setChosen] = useState<boolean[]>(() => template.items.map((i) => !onList.has(keyOf(i.name))));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const count = chosen.filter(Boolean).length;

  async function add() {
    setBusy(true); setErr("");
    const rows = template.items.filter((_, i) => chosen[i]).map((i) => ({
      family_id: data.family!.id, created_by: userId, name: i.name, qty: i.qty, unit: i.unit, category: i.category,
    }));
    const { error } = await supabase.from("extras").insert(rows);
    setBusy(false);
    if (error) setErr(errorText(error)); else onAdded(rows.length);
  }

  return (
    <div className="stack">
      {template.items.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>Listen er tom.</p>
      ) : (
        <>
          <div className="row">
            <button className="link" onClick={() => setChosen(chosen.map(() => true))}>Vælg alle</button>
            <button className="link" onClick={() => setChosen(chosen.map(() => false))}>Fravælg alle</button>
          </div>
          <ul className="items" style={{ marginTop: 0 }}>
            {template.items.map((it, i) => (
              <li key={i} className={"item" + (chosen[i] ? " done" : "")} role="checkbox" aria-checked={chosen[i]} tabIndex={0}
                style={{ opacity: chosen[i] ? 1 : 0.55 }}
                onClick={() => setChosen(chosen.map((c, j) => (j === i ? !c : c)))}
                onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); setChosen(chosen.map((c, j) => (j === i ? !c : c))); } }}>
                <span className="box"><svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.2 3L13 4.5" stroke="var(--bg)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
                <div className="main"><div className="nm" style={{ textDecoration: "none", color: "var(--ink)" }}>{it.name.charAt(0).toUpperCase() + it.name.slice(1)}</div>
                  {onList.has(keyOf(it.name)) && <div className="from">Står allerede på listen</div>}</div>
                <span className="qty" style={{ textDecoration: "none", color: "var(--ink)" }}>{[it.qty != null ? fmt(it.qty) : "", it.unit].filter(Boolean).join(" ")}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {err && <p className="status err">{err}</p>}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="row">
          {onBack && <button className="link" onClick={onBack}>Alle lister</button>}
          {isParent && <button className="link" onClick={onEdit}>Ret listen</button>}
        </span>
        <button className="btn" disabled={busy || count === 0} onClick={add}>Tilføj {count} {count === 1 ? "vare" : "varer"}</button>
      </div>
    </div>
  );
}

function TemplateEditor({ data, userId, template, onDone }: {
  data: FamilyData; userId: string; template?: ShoppingTemplate; onDone: (id?: string) => void;
}) {
  const [name, setName] = useState(template?.name ?? "Ugens faste");
  const [items, setItems] = useState<TemplateItem[]>(template?.items ?? []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  function addLine(e: React.FormEvent) {
    e.preventDefault();
    // Flere varer kan skrives på én gang, adskilt af komma eller linjeskift.
    const parts = draft.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return;
    setItems([...items, ...parts.map((t) => { const p = parseLine(t); return { ...p, category: guessCategory(p.name) }; })]);
    setDraft("");
  }

  async function save() {
    if (!name.trim()) { setErr("Giv listen et navn."); return; }
    setBusy(true); setErr("");
    const row = { name: name.trim(), items };
    const res = template
      ? await supabase.from("shopping_templates").update(row).eq("id", template.id).select("id").single()
      : await supabase.from("shopping_templates").insert({ ...row, family_id: data.family!.id, created_by: userId }).select("id").single();
    setBusy(false);
    if (res.error) setErr(errorText(res.error)); else onDone(res.data.id);
  }

  async function remove() {
    setBusy(true);
    const { error } = await supabase.from("shopping_templates").delete().eq("id", template!.id);
    setBusy(false);
    if (error) setErr(errorText(error)); else onDone();
  }

  return (
    <div className="stack">
      <label className="field">Navn på listen
        <input id="template-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Fx Ugens faste" />
      </label>
      <form className="addline" style={{ marginTop: 0 }} onSubmit={addLine}>
        <input id="template-item" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Fx 2 l mælk, rugbrød, kaffe" autoComplete="off" enterKeyHint="done" />
        <button className="btn">Tilføj</button>
      </form>
      {items.length > 0 ? (
        <div className="chips">
          {items.map((it, i) => (
            <span key={i} className="chip">{label(it)}
              <button aria-label={`Fjern ${it.name}`} onClick={() => setItems(items.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
        </div>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>Skriv de varer, I altid køber. Du kan skrive flere ad gangen adskilt af komma.</p>
      )}
      {err && <p className="status err">{err}</p>}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="row">
          <button className="link" onClick={() => onDone(template?.id)}>Fortryd</button>
          {template && !confirmDelete && <button className="link" onClick={() => setConfirmDelete(true)}>Slet listen</button>}
          {confirmDelete && <button className="btn danger small" disabled={busy} onClick={remove}>Slet {template!.name}</button>}
        </span>
        <button className="btn" disabled={busy || !name.trim()} onClick={save}>Gem liste</button>
      </div>
    </div>
  );
}
