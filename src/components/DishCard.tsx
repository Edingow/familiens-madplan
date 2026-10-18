import { useState } from "react";
import { errorText, supabase } from "../lib/supabase";
import type { Dish } from "../lib/types";
import type { FamilyData } from "../lib/useFamily";
import { hostOf, nextDays } from "../lib/util";

interface Props {
  dish: Dish;
  data: FamilyData;
  userId: string;
  onFill: (d: Dish) => void;
  onChanged: () => void;
  children?: React.ReactNode;
}

/** Fælles kort for en ret på madplanen eller til afstemning. */
export function DishCard({ dish, data, userId, onFill, onChanged, children }: Props) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const isParent = data.me?.role === "parent";
  const author = data.members.find((m) => m.user_id === dish.created_by)?.display_name;
  const activeItems = dish.items.filter((i) => !i.off).length;
  const canDelete = isParent || (dish.created_by === userId && dish.status === "voting");

  async function patch(p: Partial<Dish>) {
    setErr("");
    const { error } = await supabase.from("dishes").update(p).eq("id", dish.id);
    if (error) setErr(errorText(error)); else onChanged();
  }
  async function remove() {
    const { error } = await supabase.from("dishes").delete().eq("id", dish.id);
    if (error) setErr(errorText(error)); else onChanged();
  }

  return (
    <article className="card">
      <div className="card-head">
        {dish.image && <img src={dish.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).hidden = true; }} />}
        <div className="main">
          <h3>{dish.title}</h3>
          <span className="muted small">
            {[author && `Foreslået af ${author}`, dish.items.length ? `${activeItems} ingredienser` : "Ingen ingredienser endnu"].filter(Boolean).join(" · ")}
          </span>
          {dish.note && <span className="small">{dish.note}</span>}
          {dish.url && <a className="small" href={dish.url} target="_blank" rel="noopener noreferrer">{hostOf(dish.url)}</a>}
        </div>
      </div>

      {children}

      {isParent && dish.items.length === 0 && (
        <div className="row"><button className="btn small" onClick={() => onFill(dish)}>Hent ingredienser</button></div>
      )}

      {isParent && dish.status === "planned" && (
        <label className="field">Dag
          <select id={`day-${dish.id}`} value={dish.plan_date ?? ""} onChange={(e) => patch({ plan_date: e.target.value || null })}>
            <option value="">Ingen bestemt dag</option>
            {nextDays().map((d) => <option key={d.iso} value={d.iso}>{d.label}</option>)}
            {dish.plan_date && !nextDays().some((d) => d.iso === dish.plan_date) && <option value={dish.plan_date}>{dish.plan_date}</option>}
          </select>
        </label>
      )}

      {dish.items.length > 0 && (
        <button className="link" style={{ justifySelf: "start" }} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Skjul ingredienser" : "Vis ingredienser"}
        </button>
      )}
      {open && (
        <div className="stack">
          {dish.servings_base && isParent && dish.status === "planned" && (
            <div className="serv">
              <span>Personer</span>
              <button className="step" aria-label="Færre" onClick={() => patch({ servings: Math.max(1, (dish.servings || dish.servings_base!) - 1) })}>−</button>
              <b>{dish.servings || dish.servings_base}</b>
              <button className="step" aria-label="Flere" onClick={() => patch({ servings: (dish.servings || dish.servings_base!) + 1 })}>+</button>
              <span className="small">(opskrift til {dish.servings_base})</span>
            </div>
          )}
          <div className="chips">
            {dish.items.map((it, i) => (
              <span key={i} className={"chip" + (it.off ? " off" : "")}>{it.name}
                {isParent && (
                  <button aria-label={(it.off ? "Tilbage på listen: " : "Har vi: ") + it.name}
                    onClick={() => patch({ items: dish.items.map((x, j) => (j === i ? { ...x, off: !x.off } : x)) })}>{it.off ? "↺" : "×"}</button>
                )}
              </span>
            ))}
          </div>
          {isParent && <p className="muted small" style={{ margin: 0 }}>Tryk × på det, I allerede har derhjemme.</p>}
        </div>
      )}

      {err && <p className="status err">{err}</p>}
      {canDelete && (
        <div className="row end"><button className="link" onClick={remove}>{dish.status === "voting" ? "Træk forslaget tilbage" : "Fjern fra madplanen"}</button></div>
      )}
    </article>
  );
}
