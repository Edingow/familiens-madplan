import { useState } from "react";
import { errorText, supabase } from "../lib/supabase";

/** Vejledning og personlig adresse til iOS-genvejen "Gem opskrift". */
export function ShareSettings() {
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  async function load(renew = false) {
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("my_share_key", { renew });
    setBusy(false);
    if (error) setErr(errorText(error));
    else setLink(`${location.origin}/api/share?key=${data}`);
  }

  return (
    <section className="stack">
      <h2>Gem fra Safari og Instagram</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Med en genvej på din iPhone kan du trykke Del på en opskrift i Safari, Instagram eller TikTok og gemme den direkte i Opskrifter.
      </p>
      {!link ? (
        <div className="row"><button className="btn ghost" disabled={busy} onClick={() => load()}>Vis min genvejsadresse</button></div>
      ) : (
        <div className="stack">
          <div className="code small" style={{ fontSize: ".8rem", letterSpacing: 0, overflowWrap: "anywhere", lineHeight: 1.4 }}>{link}</div>
          <div className="row">
            <button className="btn small" onClick={() => {
              navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
            }}>{copied ? "Kopieret" : "Kopiér adressen"}</button>
            <button className="link" disabled={busy} onClick={() => load(true)}>Lav en ny adresse</button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>Adressen er personlig. Opskrifter, du gemmer med den, står med dit navn. Lav en ny, hvis den er blevet delt med andre.</p>
        </div>
      )}
      {err && <p className="status err">{err}</p>}
    </section>
  );
}
