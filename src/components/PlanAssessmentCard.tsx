import { useEffect, useState } from "react";
import { assessPlan, decidePoint, plannedIds } from "../lib/assess";
import { errorText } from "../lib/supabase";
import type { FamilyData } from "../lib/useFamily";

/** Claudes vurdering af ugens madplan ud fra kostrådene. */
export function PlanAssessmentCard({ data, onChanged }: { data: FamilyData; onChanged: () => void }) {
  const isParent = data.me?.role === "parent";
  const a = data.family?.plan_assessment;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // "Luk vurdering" huskes på denne telefon, indtil der kommer en ny vurdering.
  const hideKey = `vurdering-skjult:${data.family?.plan_assessed_at ?? ""}`;
  const readHidden = () => { try { return localStorage.getItem(hideKey) === "1"; } catch { return false; } };
  const [hidden, setHidden] = useState(readHidden);
  useEffect(() => { setHidden(readHidden()); }, [hideKey]);
  const setHide = (h: boolean) => { setHidden(h); try { h ? localStorage.setItem(hideKey, "1") : localStorage.removeItem(hideKey); } catch { /* ignorer */ } };
  const hasPlan = data.dishes.some((d) => d.status === "planned");
  if (!hasPlan || (!a && !isParent)) return null;

  const stale = !!a && a.dishIds !== plannedIds(data.dishes);
  async function decide(i: number, accept: boolean) {
    setBusy(true); setErr("");
    try { await decidePoint(data, i, accept); onChanged(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  }
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
  const label = a.rating === "god" ? "God" : a.rating === "middel" ? "Middel" : "Mindre god";
  const open = a.points.filter((p) => p.kind === "minus" && !p.status).length;
  if (hidden) {
    return (
      <button className="card" style={{ marginTop: 16, width: "100%", textAlign: "left", cursor: "pointer" }} onClick={() => setHide(false)}>
        <span className="row" style={{ justifyContent: "space-between", width: "100%" }}>
          <span><b>Vurdering af ugen</b>{open && isParent ? <span className="muted small"> · {open} forslag venter</span> : null}</span>
          <span className="row" style={{ gap: 8 }}><span className={pill}>{label}</span><span className="muted small">Vis</span></span>
        </span>
      </button>
    );
  }
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b>Vurdering af ugen</b>
        <span className={pill}>{label}</span>
      </div>
      <div className="small">{a.summary}</div>
      <ul className="small" style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 4 }}>
        {a.points.map((p, i) => (
          <li key={i} style={{ display: "flex", gap: 8, opacity: p.status === "rejected" ? 0.5 : 1 }}>
            <span aria-hidden="true" style={{ color: p.kind === "plus" ? "var(--yes)" : "var(--no)", fontWeight: 700 }}>{p.kind === "plus" ? "+" : "−"}</span>
            <span style={{ display: "grid", gap: 4, flex: 1 }}>
              <span style={{ textDecoration: p.status === "rejected" ? "line-through" : "none" }}>{p.text}</span>
              {p.kind === "minus" && p.swaps && p.swaps.length > 0 && !p.status && (
                <span className="muted">Byt {p.swaps.map((w) => `${w.from} til ${w.to}`).join(", ")}</span>
              )}
              {p.status === "accepted" && <span style={{ color: "var(--yes)", fontWeight: 600 }}>{p.swaps?.length ? "Byttet på madplanen og indkøbslisten" : "Accepteret"}</span>}
              {p.status === "rejected" && <span className="muted">Afvist</span>}
              {p.kind === "minus" && !p.status && isParent && (
                <span className="row" style={{ gap: 6 }}>
                  <button className="btn small" disabled={busy} onClick={() => decide(i, true)}>Acceptér</button>
                  <button className="btn ghost small" disabled={busy} onClick={() => decide(i, false)}>Afvis</button>
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <div className="muted small">Et skøn fra Claude ud fra kostrådene og retternes ingredienser.</div>
      {stale && <div className="small"><b>Madplanen er ændret siden vurderingen.</b></div>}
      <div className="row">
        {isParent && <button className="link" style={{ padding: 0 }} disabled={busy} onClick={run}>{busy ? "Vurderer…" : "Vurdér igen"}</button>}
        <button className="link" style={{ padding: 0 }} onClick={() => setHide(true)}>Luk vurdering</button>
      </div>
      {err && <p className="status err">{err}</p>}
    </div>
  );
}
