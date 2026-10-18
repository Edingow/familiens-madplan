import { useState } from "react";
import { planRecipe } from "../lib/actions";
import { errorText, supabase } from "../lib/supabase";
import type { Dish, Recipe } from "../lib/types";
import type { FamilyData } from "../lib/useFamily";
import { dayLabel, nextDays } from "../lib/util";

interface Props { data: FamilyData; userId: string; onFill: (d: Dish) => void; onChanged: () => void; openAdd: () => void; goTo: (tab: "recipes" | "vote") => void }

/** Ugens madplan: kun de valgte retter, dag for dag. */
export function MealPlan({ data, userId, onFill, onChanged, goTo }: Props) {
  const isParent = data.me?.role === "parent";
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const planned = data.dishes.filter((d) => d.status === "planned");
  const days = nextDays();
  const dayIsos = new Set(days.map((d) => d.iso));
  const undated = planned.filter((d) => !d.plan_date || !dayIsos.has(d.plan_date));
  const voteOpen = !!data.family?.plan_vote_open;
  const nameOf = (id: string) => data.members.find((m) => m.user_id === id)?.display_name ?? "Ukendt";

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr("");
    try { await fn(); onChanged(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  }
  const check = async (p: PromiseLike<{ error: unknown }>) => { const { error } = await p; if (error) throw error; };

  /** Erstat en ret med en foreslået opskrift på samme dag. */
  const swap = (d: Dish, r: Recipe) => run(async () => {
    await planRecipe(r, userId, { status: "planned", date: d.plan_date ?? undefined, servings: d.servings ?? r.servings_base });
    await check(supabase.from("dishes").delete().eq("id", d.id));
    if (r.suggested) await check(supabase.from("recipes").update({ suggested: false }).eq("id", r.id));
  });

  const row = (d: Dish) => {
    const marks = data.votes.filter((v) => v.dish_id === d.id && v.value === -1);
    const proposals = marks
      .map((v) => ({ v, r: data.recipes.find((r) => r.id === v.suggestion_recipe_id) }))
      .filter((x): x is { v: typeof x.v; r: Recipe } => !!x.r);
    return (
      <div key={d.id} className="plan-item">
        <div className="plan-row">
          <div className="main">
            <div className="nm">{d.url ? <a href={d.url} target="_blank" rel="noopener noreferrer">{d.title}</a> : d.title}</div>
            <div className="row" style={{ gap: 6 }}>
              {marks.length > 0 && <button className="pill warn" style={{ border: 0 }} onClick={() => goTo("vote")}>{marks.length === 1 ? `Ikke for ${nameOf(marks[0].user_id)}` : `Ikke for ${marks.length} af jer`}</button>}
              {isParent && d.items.length === 0 && <button className="link" style={{ padding: 0 }} onClick={() => onFill(d)}>Hent ingredienser</button>}
            </div>
          </div>
          {isParent && (
            <>
              <select aria-label={`Dag for ${d.title}`} className="day-select" value={d.plan_date && dayIsos.has(d.plan_date) ? d.plan_date : ""}
                onChange={(e) => run(() => check(supabase.from("dishes").update({ plan_date: e.target.value || null }).eq("id", d.id)))}>
                <option value="">Ingen dag</option>
                {days.map((x) => <option key={x.iso} value={x.iso}>{x.short}</option>)}
              </select>
              <button className="icon-btn" aria-label={`Fjern ${d.title} fra madplanen`} disabled={busy}
                onClick={() => run(() => check(supabase.from("dishes").delete().eq("id", d.id)))}>×</button>
            </>
          )}
        </div>
        {isParent && proposals.map(({ v, r }) => (
          <div key={v.user_id} className="proposal">
            <span className="small"><b>{nameOf(v.user_id)}</b> foreslår <b>{r.title}</b>{v.comment ? ` · "${v.comment}"` : ""}</span>
            <button className="btn small" disabled={busy} onClick={() => swap(d, r)}>Byt</button>
          </div>
        ))}
      </div>
    );
  };

  if (!planned.length) {
    return (
      <div className="empty">
        <h2>Madplanen er tom</h2>
        <p>{isParent ? "Vælg retter under Opskrifter og læg dem på madplanen. Send den derefter til afstemning, så resten af familien kan sige deres mening." : "Når madplanen er lagt, kan du se den her."}</p>
        <button className="btn" onClick={() => goTo("recipes")}>Gå til opskrifter</button>
      </div>
    );
  }

  const reviewed = data.members.filter((m) => data.reviews.some((r) => r.user_id === m.user_id));
  const missing = data.members.filter((m) => m.user_id !== userId && !reviewed.includes(m));

  return (
    <>
      {isParent && (
        <div className="card" style={{ marginTop: 16 }}>
          {voteOpen ? (
            <>
              <div><b>Madplanen er sendt til afstemning.</b></div>
              <div className="small muted">
                {reviewed.length ? `Har kigget den igennem: ${reviewed.map((m) => m.display_name).join(", ")}. ` : ""}
                {missing.length ? `Mangler: ${missing.map((m) => m.display_name).join(", ")}.` : "Alle har kigget den igennem."}
              </div>
              <div className="row">
                <button className="btn ghost small" disabled={busy} onClick={() => goTo("vote")}>Se svarene</button>
                <button className="btn ghost small" disabled={busy} onClick={() => run(() => check(supabase.rpc("close_plan_vote")))}>Luk afstemningen</button>
              </div>
            </>
          ) : (
            <>
              <div className="small muted">Når planen er klar, kan resten af familien markere det, de ikke har lyst til, og foreslå noget andet.</div>
              <button className="btn" disabled={busy} onClick={() => run(() => check(supabase.rpc("send_plan_vote")))}>Send madplanen til afstemning</button>
            </>
          )}
        </div>
      )}
      {!isParent && voteOpen && (
        <div className="banner">Madplanen er sendt til afstemning. <button className="link" style={{ color: "inherit" }} onClick={() => goTo("vote")}>Sig din mening</button></div>
      )}
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
              <p style={{ margin: 0 }}>Ugens retter fjernes fra madplanen, afstemningen lukkes, og indkøbslisten ryddes for hele familien. Opskrifterne bliver liggende.</p>
              <div className="row end">
                <button className="btn ghost" onClick={() => setConfirm(false)}>Behold</button>
                <button className="btn danger" onClick={() => { setConfirm(false); run(() => check(supabase.rpc("new_week"))); }}>Start ny uge</button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
