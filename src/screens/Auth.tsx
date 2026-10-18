import { useState } from "react";
import { errorText, supabase } from "../lib/supabase";

export function Auth() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message === "Invalid login credentials" ? "Forkert e-mail eller adgangskode." : error.message);
      } else {
        if (password.length < 8) throw new Error("Adgangskoden skal være mindst 8 tegn.");
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (!data.session) setMsg({ text: "Tjek din mail og tryk på linket for at bekræfte kontoen. Log derefter ind her." });
      }
    } catch (err) { setMsg({ text: errorText(err), err: true }); }
    finally { setBusy(false); }
  }

  return (
    <div className="app">
      <form className="auth" onSubmit={submit}>
        <div className="stack">
          <h1>Familiens Madplan</h1>
          <p className="muted" style={{ margin: 0 }}>Madplan, afstemning og fælles indkøbsliste for hele familien.</p>
        </div>
        <div className="segmented" role="group">
          <button type="button" aria-pressed={mode === "login"} onClick={() => setMode("login")}>Log ind</button>
          <button type="button" aria-pressed={mode === "signup"} onClick={() => setMode("signup")}>Opret konto</button>
        </div>
        <label className="field">E-mail
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">Adgangskode
          <input id="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="btn" disabled={busy}>{mode === "login" ? "Log ind" : "Opret konto"}</button>
        {msg && <p className={"status" + (msg.err ? " err" : "")}>{msg.text}</p>}
      </form>
    </div>
  );
}
