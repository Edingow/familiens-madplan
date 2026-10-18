import { useState } from "react";
import { errorText, supabase } from "../lib/supabase";

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"join" | "create">("join");
  const [name, setName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const { error } = mode === "create"
        ? await supabase.rpc("create_family", { family_name: familyName.trim(), my_name: name.trim() })
        : await supabase.rpc("join_family", { code: code.trim(), my_name: name.trim() });
      if (error) throw error;
      onDone();
    } catch (e) { setErr(errorText(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="app">
      <form className="auth" onSubmit={submit}>
        <h1>Find jeres familie</h1>
        <div className="segmented" role="group">
          <button type="button" aria-pressed={mode === "join"} onClick={() => setMode("join")}>Jeg har en kode</button>
          <button type="button" aria-pressed={mode === "create"} onClick={() => setMode("create")}>Opret familie</button>
        </div>
        <label className="field">Dit navn
          <input id="my-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Fx Jon" />
        </label>
        {mode === "create" ? (
          <label className="field">Familiens navn
            <input id="family-name" required value={familyName} onChange={(e) => setFamilyName(e.target.value)} placeholder="Fx Henriksen" />
          </label>
        ) : (
          <label className="field">Familiekode
            <input id="code" required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="8 tegn" autoCapitalize="characters" autoComplete="off" />
            <span className="muted small">Koden står under Indstillinger hos den, der har oprettet familien.</span>
          </label>
        )}
        <button className="btn" disabled={busy}>{mode === "create" ? "Opret familie" : "Bliv en del af familien"}</button>
        {err && <p className="status err">{err}</p>}
        <button type="button" className="link" onClick={() => supabase.auth.signOut()}>Log ud</button>
      </form>
    </div>
  );
}
