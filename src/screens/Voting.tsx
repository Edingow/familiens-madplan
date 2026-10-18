import { useEffect, useState } from "react";
import { errorText, supabase } from "../lib/supabase";
import type { Dish, Vote } from "../lib/types";
import type { FamilyData } from "../lib/useFamily";
import { dayLabel } from "../lib/util";

interface Props { data: FamilyData; userId: string; onChanged: () => void; goTo: (tab: "plan" | "recipes") => void }

/** Afstemning om ugens madplan: marker det, du ikke har lyst til, og skriv kort hvorfor. */
export function Voting({ data, userId, onChanged, goTo }: Props) {
  const planned = data.dishes
    .filter((d) => d.status === "planned")
    .sort((a, b) => (a.plan_date ?? "9999").localeCompare(b.plan_date ?? "9999"));
  const totalDislikes = data.votes.filter((v) => v.value === -1 && planned.some((d) => d.id === v.dish_id)).length;

  if (!planned.length) {
    return (
      <div className="empty">
        <h2>Ingen madplan at stemme om</h2>
        <p>Når ugens madplan er lagt, kan alle i familien markere de retter, de ikke har lyst til, med en kort kommentar.</p>
        <button className="btn" onClick={() => goTo("plan")}>Se madplanen</button>
      </div>
    );
  }

  return (
    <>
      <p className="muted" style={{ margin: "16px 0 0" }}>
        Tryk <b>Ikke for mig</b> ved de retter, du ikke har lyst til, og skriv gerne hvorfor.
        {totalDislikes > 0 ? ` Lige nu er der ${totalDislikes} ${totalDislikes === 1 ? "markering" : "markeringer"}.` : " Ingen har markeret noget endnu."}
      </p>
      <div className="section">
        {planned.map((d) => <VoteCard key={d.id} dish={d} data={data} userId={userId} onChanged={onChanged} />)}
      </div>
    </>
  );
}

function VoteCard({ dish, data, userId, onChanged }: { dish: Dish; data: FamilyData; userId: string; onChanged: () => void }) {
  const marks = data.votes.filter((v) => v.dish_id === dish.id && v.value === -1);
  const mine = marks.find((v) => v.user_id === userId);
  const [comment, setComment] = useState(mine?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => { setComment(mine?.comment ?? ""); }, [mine?.comment]);
  const nameOf = (v: Vote) => data.members.find((m) => m.user_id === v.user_id)?.display_name ?? "Ukendt";

  async function toggle() {
    setBusy(true); setErr("");
    const { error } = mine
      ? await supabase.from("votes").delete().eq("dish_id", dish.id).eq("user_id", userId)
      : await supabase.from("votes").upsert({ dish_id: dish.id, user_id: userId, value: -1, comment: null });
    setBusy(false);
    if (error) setErr(errorText(error)); else { setComment(""); onChanged(); }
  }
  async function saveComment(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const { error } = await supabase.from("votes").update({ comment: comment.trim() || null }).eq("dish_id", dish.id).eq("user_id", userId);
    setBusy(false);
    if (error) setErr(errorText(error)); else { setSaved(true); setTimeout(() => setSaved(false), 1500); onChanged(); }
  }

  const others = marks.filter((v) => v.user_id !== userId);
  return (
    <article className="card">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
        <div className="main">
          <div className="muted small">{dish.plan_date ? dayLabel(dish.plan_date) : "Uden dag"}</div>
          <h3>{dish.title}</h3>
        </div>
        <button className="vote no" style={{ flex: "none" }} aria-pressed={!!mine} disabled={busy} onClick={toggle}>
          {mine ? "Ikke for mig ✓" : "Ikke for mig"}
        </button>
      </div>

      {mine && (
        <form className="row" style={{ flexWrap: "nowrap" }} onSubmit={saveComment}>
          <input id={`comment-${dish.id}`} value={comment} maxLength={200} onChange={(e) => setComment(e.target.value)} placeholder="Hvorfor? Fx for stærk, fik det i går" autoComplete="off" />
          <button className="btn small" disabled={busy || comment.trim() === (mine.comment ?? "")}>{saved ? "Gemt" : "Gem"}</button>
        </form>
      )}

      {others.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          {others.map((v) => (
            <div key={v.user_id} className="small"><b>{nameOf(v)}</b>: ikke for mig{v.comment ? ` · "${v.comment}"` : ""}</div>
          ))}
        </div>
      )}
      {err && <p className="status err">{err}</p>}
    </article>
  );
}
