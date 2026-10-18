import { lazy, Suspense, useMemo, useState } from "react";
import { IconCamera, IconCheck } from "../components/Icons";
import { Templates } from "../components/Templates";
import { buildShoppingList, checkKey, guessCategory, parseLine } from "../lib/merge";
import { errorText, supabase } from "../lib/supabase";
import { CATEGORY_NAMES, DEFAULT_ORDER, type Category, type Product } from "../lib/types";
import type { FamilyData } from "../lib/useFamily";

const Scanner = lazy(() => import("../components/Scanner").then((m) => ({ default: m.Scanner })));

interface Props {
  data: FamilyData;
  userId: string;
  setChecked: (key: string, on: boolean) => void;
  onChanged: () => void;
  openAdd: () => void;
}

export function ShoppingList({ data, userId, setChecked, onChanged, openAdd }: Props) {
  const [hideDone, setHideDone] = useState(() => { try { return localStorage.getItem("hide-done") === "1"; } catch { return false; } });
  const [draft, setDraft] = useState("");
  const [scanning, setScanning] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const isParent = data.me?.role === "parent";

  const items = useMemo(() => buildShoppingList(data.dishes, data.extras), [data.dishes, data.extras]);
  const order: (Category | "basic")[] = [...(data.family?.category_order?.length ? data.family.category_order : DEFAULT_ORDER), "basic"];
  const isDone = (k: string) => data.checks.has(checkKey(k));
  const doneCount = items.filter((i) => isDone(i.key)).length;
  const planned = data.dishes.filter((d) => d.status === "planned").length;

  async function addExtra(p: { name: string; qty: number | null; unit: string; category: Category }) {
    const { error } = await supabase.from("extras").insert({ ...p, family_id: data.family!.id, created_by: userId });
    if (error) throw error;
    onChanged();
  }

  async function submitLine(e: React.FormEvent) {
    e.preventDefault();
    const t = draft.trim();
    if (!t) return;
    const p = parseLine(t);
    try { await addExtra({ ...p, category: guessCategory(p.name) }); setDraft(""); setMsg(null); }
    catch (err) { setMsg({ text: errorText(err), err: true }); }
  }

  async function onProduct(p: Product) {
    setScanning(false);
    try {
      await addExtra({ name: p.name, qty: p.qty, unit: p.unit, category: p.category });
      setMsg({ text: `Tilføjet: ${p.name}` });
    } catch (err) { setMsg({ text: errorText(err), err: true }); }
  }

  /** Købte varer forsvinder fra listen. Retterne bliver på madplanen. Uden navne ryddes hele listen. */
  async function clearList(all: boolean) {
    setConfirmClear(false); setClearing(true);
    const names = all ? null : items.filter((i) => isDone(i.key)).map((i) => i.key);
    const { error } = await supabase.rpc("clear_list", names ? { names } : {});
    setClearing(false);
    if (error) setMsg({ text: errorText(error), err: true });
    else setMsg({ text: all ? "Listen er ryddet." : `${names!.length} købte varer er fjernet.` });
    onChanged();
  }

  return (
    <>
      {items.length > 0 && (
        <div className="progress">
          <span>{doneCount} af {items.length}</span>
          <div className="bar"><i style={{ width: `${(doneCount / items.length) * 100}%` }} /></div>
          <label className="toggle">
            <input id="hide-done" type="checkbox" checked={hideDone} onChange={(e) => {
              setHideDone(e.target.checked);
              try { localStorage.setItem("hide-done", e.target.checked ? "1" : ""); } catch { /* ignorer */ }
            }} />
            Skjul købte
          </label>
        </div>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn small" onClick={() => setTemplatesOpen(true)}>+ Tilføj indkøbsliste</button>
      {items.length > 0 && (
        <>
          {doneCount > 0 && <button className="btn ghost small" disabled={clearing} onClick={() => clearList(false)}>Ryd købte varer ({doneCount})</button>}
          {isParent && !confirmClear && <button className="btn ghost small" disabled={clearing} onClick={() => setConfirmClear(true)}>Ryd hele listen</button>}
        </>
      )}
      </div>
      {confirmClear && (
        <div className="card" style={{ marginTop: 10 }}>
          <p style={{ margin: 0 }}>Alle varer fjernes fra listen for hele familien. Retterne bliver liggende på madplanen.</p>
          <div className="row end">
            <button className="btn ghost" onClick={() => setConfirmClear(false)}>Behold</button>
            <button className="btn danger" onClick={() => clearList(true)}>Ryd hele listen</button>
          </div>
        </div>
      )}

      <form className="addline" onSubmit={submitLine}>
        <input id="extra" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Tilføj vare, fx 2 l mælk" autoComplete="off" enterKeyHint="done" />
        <button className="btn">Tilføj</button>
        <button type="button" className="btn tag row" onClick={() => setScanning(true)} aria-label="Scan en vare"><IconCamera /> Scan</button>
      </form>
      {msg && <p className={"status" + (msg.err ? " err" : "")} style={{ marginTop: 8 }}>{msg.text}</p>}

      {!items.length && (
        <div className="empty">
          <h2>Listen er tom</h2>
          <p>{planned ? "Retterne på madplanen har ingen ingredienser endnu." : "Læg retter på madplanen, så kommer ingredienserne her, lagt sammen og sorteret efter afdeling. Scan eller skriv det, I mangler."}</p>
          <button className="btn" onClick={openAdd}>Tilføj en ret</button>
        </div>
      )}

      {order.map((cat) => {
        let group = items.filter((i) => i.category === cat);
        if (!group.length) return null;
        group.sort((a, b) => Number(isDone(a.key)) - Number(isDone(b.key)) || a.name.localeCompare(b.name, "da"));
        const left = group.filter((i) => !isDone(i.key)).length;
        if (hideDone) group = group.filter((i) => !isDone(i.key));
        return (
          <div className="section" key={cat}>
            <span className="sign">{CATEGORY_NAMES[cat]}<small>{left ? `${left} tilbage` : "alt købt"}</small></span>
            {group.length > 0 && (
              <ul className="items">
                {group.map((i) => {
                  const done = isDone(i.key);
                  const toggle = () => setChecked(checkKey(i.key), !done);
                  return (
                    <li key={i.key} className={"item" + (done ? " done" : "")} role="checkbox" aria-checked={done} tabIndex={0}
                      onClick={toggle} onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); } }}>
                      <span className="box"><IconCheck /></span>
                      <div className="main">
                        <div className="nm">{i.name}</div>
                        <div className="from">{i.sources.join(" · ")}</div>
                      </div>
                      <span className="qty">{i.qtyText}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}

      {data.extras.length > 0 && (
        <div className="section">
          <p className="muted small" style={{ margin: "0 0 6px" }}>Tilføjede og scannede varer</p>
          <div className="chips">
            {data.extras.map((x) => (
              <span className="chip" key={x.id}>{x.name}
                {(isParent || x.created_by === userId) && (
                  <button aria-label={`Fjern ${x.name}`} onClick={async () => { await supabase.from("extras").delete().eq("id", x.id); onChanged(); }}>×</button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {templatesOpen && (
        <Templates data={data} userId={userId} onClose={() => setTemplatesOpen(false)}
          onAdded={(n, listName) => { setTemplatesOpen(false); setMsg({ text: `${n} ${n === 1 ? "vare" : "varer"} fra ${listName} er lagt på listen.` }); onChanged(); }} />
      )}
      {scanning && <Suspense fallback={null}><Scanner onClose={() => setScanning(false)} onProduct={onProduct} /></Suspense>}
    </>
  );
}
