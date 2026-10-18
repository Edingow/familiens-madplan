import { useState } from "react";
import { errorText, supabase } from "../lib/supabase";
import { CATEGORY_NAMES, DEFAULT_ORDER, type Category } from "../lib/types";
import { clearLocalData, type FamilyData } from "../lib/useFamily";

interface Props { data: FamilyData; userId: string; onChanged: () => void }

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="row">
      <span className="code">{code}</span>
      <button className="btn ghost small" onClick={() => {
        navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
      }}>{copied ? "Kopieret" : "Kopiér"}</button>
    </div>
  );
}

export function Settings({ data, userId, onChanged }: Props) {
  const isParent = data.me?.role === "parent";
  const [name, setName] = useState(data.me?.display_name ?? "");
  const [err, setErr] = useState("");
  const order: Category[] = data.family?.category_order?.length ? data.family.category_order : DEFAULT_ORDER;

  async function saveName() {
    const { error } = await supabase.from("members").update({ display_name: name.trim() }).eq("user_id", userId);
    if (error) setErr(errorText(error)); else onChanged();
  }
  async function move(i: number, dir: -1 | 1) {
    const next = [...order];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    const { error } = await supabase.from("families").update({ category_order: next }).eq("id", data.family!.id);
    if (error) setErr(errorText(error)); else onChanged();
  }

  return (
    <div className="stack" style={{ paddingTop: 16 }}>
      <section className="stack">
        <h2>Dig</h2>
        <label className="field">Dit navn
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input id="display-name" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn small" disabled={!name.trim() || name.trim() === data.me?.display_name} onClick={saveName}>Gem</button>
          </div>
        </label>
      </section>

      <section className="stack">
        <h2>Familien {data.family?.name}</h2>
        <div className="list">
          {data.members.map((m) => (
            <div key={m.user_id}><span>{m.display_name}{m.user_id === userId ? " (dig)" : ""}</span><span className="pill">{m.role === "parent" ? "Forælder" : "Barn"}</span></div>
          ))}
        </div>
        <div className="stack">
          <span className="small"><b>Kode til børn.</b> De kan foreslå retter, stemme og krydse af på listen.</span>
          <CopyCode code={data.family?.child_code ?? ""} />
        </div>
        {isParent && (
          <div className="stack">
            <span className="small"><b>Kode til forældre.</b> Giver fuld adgang. Del den kun med den anden forælder.</span>
            <CopyCode code={data.family?.parent_code ?? ""} />
          </div>
        )}
      </section>

      <section className="stack">
        <h2>Rækkefølge i butikken</h2>
        <p className="muted small" style={{ margin: 0 }}>Sæt afdelingerne i den rækkefølge, I går gennem jeres faste supermarked.</p>
        <div className="list">
          {order.map((c, i) => (
            <div key={c}>
              <span>{CATEGORY_NAMES[c]}</span>
              {isParent && (
                <span className="row" style={{ flexWrap: "nowrap" }}>
                  <button className="step" aria-label={`Flyt ${CATEGORY_NAMES[c]} op`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                  <button className="step" aria-label={`Flyt ${CATEGORY_NAMES[c]} ned`} disabled={i === order.length - 1} onClick={() => move(i, 1)}>↓</button>
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {err && <p className="status err">{err}</p>}
      <div className="row"><button className="btn ghost" onClick={async () => { clearLocalData(); await supabase.auth.signOut(); }}>Log ud</button></div>
    </div>
  );
}
