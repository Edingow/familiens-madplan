import { useEffect, useState } from "react";
import { disablePush, enablePush, getPushState, savePrefs, type Prefs, type PushKind, type PushState } from "../lib/push";
import { errorText } from "../lib/supabase";

const LABELS: { kind: PushKind; label: string; parentsOnly?: boolean }[] = [
  { kind: "list", label: "Nye varer og retter på madplanen" },
  { kind: "vote", label: "Når madplanen sendes til afstemning" },
  { kind: "votes", label: "Når nogen har stemt", parentsOnly: true },
];

export function NotificationSettings({ userId, familyId, isParent }: { userId: string; familyId: string; isParent: boolean }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { getPushState().then(setState).catch(() => setState({ kind: "unsupported" })); }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr("");
    try { await fn(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  }

  function toggle(kind: PushKind, on: boolean) {
    if (state?.kind !== "on") return;
    const prefs: Prefs = { ...state.prefs, [kind]: on };
    setState({ ...state, prefs });
    run(() => savePrefs(state.endpoint, prefs));
  }

  return (
    <section className="stack">
      <h2>Notifikationer</h2>
      {!state && <p className="muted small" style={{ margin: 0 }}>Tjekker…</p>}
      {state?.kind === "needs-home-screen" && (
        <p className="muted small" style={{ margin: 0 }}>Notifikationer virker kun, når appen er åbnet fra hjemmeskærmen. Tryk Del i Safari og vælg Føj til hjemmeskærm, og åbn appen derfra.</p>
      )}
      {state?.kind === "unsupported" && (
        <p className="muted small" style={{ margin: 0 }}>Denne telefon eller browser kan ikke modtage notifikationer fra appen. På iPhone kræver det iOS 16.4 eller nyere.</p>
      )}
      {state?.kind === "denied" && (
        <p className="muted small" style={{ margin: 0 }}>Notifikationer er slået fra for appen. Slå dem til i iPhone-indstillinger under Notifikationer → Madplan, og åbn appen igen.</p>
      )}
      {state?.kind === "off" && (
        <div className="stack">
          <p className="muted small" style={{ margin: 0 }}>Få besked på denne telefon, når der kommer noget nyt på listen, når madplanen sendes til afstemning{isParent ? ", og når nogen har stemt" : ""}.</p>
          <div className="row"><button className="btn" disabled={busy} onClick={() => run(async () => setState(await enablePush(userId, familyId)))}>Slå notifikationer til</button></div>
        </div>
      )}
      {state?.kind === "on" && (
        <div className="stack">
          <div className="list">
            {LABELS.filter((l) => !l.parentsOnly || isParent).map((l) => (
              <div key={l.kind}>
                <label htmlFor={`push-${l.kind}`} style={{ flex: 1 }}>{l.label}</label>
                <input id={`push-${l.kind}`} type="checkbox" style={{ width: "auto" }} checked={state.prefs[l.kind]} disabled={busy} onChange={(e) => toggle(l.kind, e.target.checked)} />
              </div>
            ))}
          </div>
          <p className="muted small" style={{ margin: 0 }}>Om indkøbslisten får I højst én besked hvert 10. minut.</p>
          <div className="row"><button className="link" disabled={busy} onClick={() => run(async () => { await disablePush(state.endpoint); setState({ kind: "off" }); })}>Slå notifikationer fra på denne telefon</button></div>
        </div>
      )}
      {err && <p className="status err">{err}</p>}
    </section>
  );
}
