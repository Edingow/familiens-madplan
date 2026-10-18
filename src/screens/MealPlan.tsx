import { useState } from "react";
import { errorText, supabase } from "../lib/supabase";
import type { Dish } from "../lib/types";
import type { FamilyData } from "../lib/useFamily";
import { dayLabel, nextDays } from "../lib/util";

interface Props { data: FamilyData; userId: string; onFill: (d: Dish) => void; onChanged: () => void; openAdd: () => void; goTo: (tab: "recipes" | "vote") => void }

/** Ugens madplan: kun dag og ret. Opskrifterne ligger under Opskrifter. */
export function MealPlan({ data, onFill, onChanged, goTo }: Props) {
  const isParent = data.me?.role === "parent";
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState("");
  const planned = data.dishes.filter((d) => d.status === "planned");
  const days = nextDays();
  const dayIsos = new Set(days.map((d) => d.iso));
  const undated = planned.filter((d) => !d.plan_date || !dayIsos.has(d.plan_date));

  async function patch(d: Dish, p: Partial<Dish>) {
    setErr("");
    const { error } = await supabase.from("dishes").update(p).eq("id", d.id);
    if (error) setErr(errorText(error)); else onChanged();
  }
  async function remove(d: Dish) {
    setErr("");
    const { error } = await supabase.from("dishes").delete().eq("id", d.id);
    if (error) setErr(errorText(error)); else onChanged();
  }
  async function newWeek() {
    setConfirm(false);
    const { error } = await supabase.rpc("new_week");
    if (error) setErr(errorText(error)); else onChanged();
  }

  const row = (d: Dish) => {
    const dislikes = data.votes.filter((v) => v.dish_id === d.id && v.value === -1).length;
    return (
      <div key={d.id} className="plan-row">
        <div className="main">
          <div className="nm">{d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer">{d.title}</a> : d.title}</div>
          <div className="row" style={{ gap: 6 }}>
            {dislikes > 0 && <button className="pill warn" style={{ border: 0 }} onClick={() => goTo("vote")}>{dislikes} ikke for mig</button>}
            {isParent && d.items.length === 0 && <button className="link" style={{ padding: 0 }} onClick={() => onFill(d)}>Hent ingredienser</button>}
          </div>
        </div>
        {isParent && (
          <>
            <select aria-label={`Dag for ${d.title}`} className="day-select" value={d.plan_date && dayIsos.has(d.plan_date) ? d.plan_date : ""}
              onChange={(e) => patch(d, { plan_date: e.target.value || null })}>
              <option value="">Ingen dag</option>
              {days.map((x) => <option key={x.iso} value={x.iso}>{x.short}</option>)}
            </select>
            <button className="icon-btn" aria-label={`Fjern ${d.title} fra madplanen`} onClick={() => remove(d)}>×</button>
          </>
        )}
      </div>
    );
  };

  if (!planned.length) {
    return (
      <div className="empty">
        <h2>Madplanen er tom</h2>
        <p>{isParent ? "Vælg retter under Opskrifter og læg dem på madplanen. Derefter kan resten af familien sige, hvad de ikke har lyst til." : "Når madplanen er lagt, kan du se den her og sige, hvad du ikke har lyst til."}</p>
        <button className="btn" onClick={() => goTo("recipes")}>Gå til opskrifter</button>
      </div>
    );
  }

  return (
    <>
      {err && <p className="status err" style={{ marginTop: 12 }}>{err}</p>}
      <div className="list" style={{ marginTop: 16 }}>
        {days.map((day) => {
          const list = planned.filter((x) => x.plan_date === day.iso);
          return (
            <div key={day.iso} className="plan-day">
              <div className="day-label">{day.label}</div>
              {list.length ? list.map(row) : <div className="muted small">Ingen ret</div>}
            </div>
          );
        })}
        {undated.length > 0 && (
          <div className="plan-day">
            <div className="day-label">Uden dag</div>
            {undated.map((d) => (
              <div key={d.id}>
                {d.plan_date && <div className="muted small">Var planlagt {dayLabel(d.plan_date)}</div>}
                {row(d)}
              </div>
            ))}
          </div>
        )}
      </div>

      {isParent && (
        <div className="section">
          {!confirm ? (
            <button className="btn ghost small" onClick={() => setConfirm(true)}>Ny uge: ryd madplanen</button>
          ) : (
            <div className="card">
              <p style={{ margin: 0 }}>Ugens retter fjernes fra madplanen, og indkøbslisten ryddes for hele familien. Opskrifterne bliver liggende.</p>
              <div className="row end">
                <button className="btn ghost" onClick={() => setConfirm(false)}>Behold</button>
                <button className="btn danger" onClick={newWeek}>Start ny uge</button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
