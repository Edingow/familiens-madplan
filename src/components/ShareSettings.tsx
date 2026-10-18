import { useEffect, useState } from "react";
import { errorText, supabase } from "../lib/supabase";

/** Delt iOS-genvej "Gem opskrift". Den spørger om adressen, når man tilføjer den. */
const SHORTCUT_URL = "https://www.icloud.com/shortcuts/24fb0826e2184642942c017fcf3a2661";

/** Installér iOS-genvejen med ét tryk: adressen kopieres, og genvejen åbnes. */
export function ShareSettings() {
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [showAddress, setShowAddress] = useState(false);

  async function load(renew = false) {
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("my_share_key", { renew });
    setBusy(false);
    if (error) setErr(errorText(error));
    else setLink(`${location.origin}/api/share?key=${data}`);
  }
  useEffect(() => { load(); }, []);

  // Skal ske direkte i trykket, ellers afviser iPhone at kopiere.
  function copy() {
    if (!link) return;
    navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); }).catch(() => setShowAddress(true));
  }

  return (
    <section className="stack">
      <h2>Gem fra Safari og Instagram</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Med genvejen kan du trykke Del på en opskrift i Safari, Instagram, Facebook eller TikTok og vælge Gem opskrift. Så havner den direkte i Opskrifter.
      </p>
      <ol className="small" style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>
        <li>Tryk <b>Installér genvejen</b>. Din personlige adresse bliver kopieret.</li>
        <li>Tryk <b>Tilføj genvej</b> i Genveje-appen.</li>
        <li>Når den spørger om adressen, så hold fingeren i feltet og vælg <b>Sæt ind</b>.</li>
      </ol>
      <div className="row">
        <a className="btn" href={SHORTCUT_URL} target="_blank" rel="noopener noreferrer" onClick={copy}
          aria-disabled={!link} style={{ textDecoration: "none", pointerEvents: link ? "auto" : "none", opacity: link ? 1 : 0.5 }}>
          Installér genvejen
        </a>
        <button className="link" onClick={() => setShowAddress(!showAddress)}>{showAddress ? "Skjul adressen" : "Vis min adresse"}</button>
      </div>
      {copied && <p className="status">Adressen er kopieret. Sæt den ind, når genvejen spørger.</p>}
      {showAddress && link && (
        <div className="stack">
          <div className="code small" style={{ fontSize: ".8rem", letterSpacing: 0, overflowWrap: "anywhere", lineHeight: 1.4 }}>{link}</div>
          <div className="row">
            <button className="btn ghost small" onClick={copy}>Kopiér adressen</button>
            <button className="link" disabled={busy} onClick={() => load(true)}>Lav en ny adresse</button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>Adressen er personlig. Opskrifter, du gemmer med den, står med dit navn. Laver du en ny, skal genvejen installeres igen.</p>
        </div>
      )}
      {err && <p className="status err">{err}</p>}
    </section>
  );
}
