import { useState } from "react";
import { assessPlan, plannedIds } from "../lib/assess";
import { errorText } from "../lib/supabase";
import type { FamilyData } from "../lib/useFamily";

/** Claudes vurdering af ugens madplan ud fra kostrådene. */
export function PlanAssessmentCard({ data, onChanged }: { data: FamilyData; onChanged: () => void }) {
  const isParent = data.me?.role === "parent";
  const a = data.family?.plan_assessment;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const hasPlan = data.dishes.some((d) => d.status === "planned");
  if (!hasPlan || (!a && !isParent)) return null;

  const stale = !!a && a.dishIds !== plannedIds(data.dishes);
  async function run() {
    setBusy(true); setErr("");
    try { await assessPlan(data); onChanged(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  }

  if (!a) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <div className="small muted">Få et hurtigt bud på, hvor sund og varieret ugens madplan er, ud fra Fødevarestyrelsens kostråd.</div>
        <div className="row"><button className="btn ghost small" disabled={busy} onClick={run}>{busy ? "Vurderer…" : "Vurdér madplanen"}</button></div>
        {err && <p className="status err">{err}</p>}
      </div>
    );
  }

  const pill = a.rating === "god" ? "pill" : a.rating === "middel" ? "pill warn" : "pill bad";
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>Vurdering af ugen</b>
        <span className={pill}>{a.rating === "god" ? "God" : a.rating === "middel" ? "Middel" : "Mindre god"}</span>
      </div>
      <div className="small">{a.summary}</div>
      <ul className="small" style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 4 }}>
        {a.points.map((p, i) => (
          <li key={i} style={{ display: "flex", gap: 8 }}>
            <span aria-hidden="true" style={{ color: p.kind === "plus" ? "var(--yes)" : "var(--no)", fontWeight: 700 }}>{p.kind === "plus" ? "+" : "−"}</span>
            <span>{p.text}</span>
          </li>
        ))}
      </ul>
      <div className="muted small">Et skøn fra Claude ud fra kostrådene og retternes ingredienser.</div>
      {stale && <div className="small"><b>Madplanen er ændret siden vurderingen.</b></div>}
      {isParent && <div className="row"><button className="link" style={{ padding: 0 }} disabled={busy} onClick={run}>{busy ? "Vurderer…" : "Vurdér igen"}</button></div>}
      {err && <p className="status err">{err}</p>}
    </div>
  );
}
