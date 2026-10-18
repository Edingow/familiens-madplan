import { useState } from "react";
import { DishCard } from "../components/DishCard";
import { errorText, supabase } from "../lib/supabase";
import type { Dish } from "../lib/types";
import type { FamilyData } from "../lib/useFamily";
import { deadlineText, nextDays } from "../lib/util";

interface Props { data: FamilyData; userId: string; onFill: (d: Dish) => void; onChanged: () => void; openAdd: () => void }

export function Voting({ data, userId, onFill, onChanged, openAdd }: Props) {
  const [err, setErr] = useState("");
  const isParent = data.me?.role === "parent";
  const voting = data.dishes.filter((d) => d.status === "voting");
  const nameOf = (id: string) => data.members.find((m) => m.user_id === id)?.display_name ?? "Ukendt";

  const tally = (d: Dish) => {
    const vs = data.votes.filter((v) => v.dish_id === d.id);
    return { yes: vs.filter((v) => v.value === 1), no: vs.filter((v) => v.value === -1), mine: vs.find((v) => v.user_id === userId)?.value };
  };
  // Flest ja-stemmer øverst, så familiens favoritter er lette at finde.
  const sorted = [...voting].sort((a, b) => {
    const ta = tally(a), tb = tally(b);
    return (tb.yes.length - tb.no.length) - (ta.yes.length - ta.no.length);
  });

  async function vote(d: Dish, value: 1 | -1, current?: number) {
    setErr("");
    const { error } = current === value
      ? await supabase.from("votes").delete().eq("dish_id", d.id).eq("user_id", userId)
      : await supabase.from("votes").upsert({ dish_id: d.id, user_id: userId, value });
    if (error) setErr(errorText(error)); else onChanged();
  }

  async function plan(d: Dish, date: string) {
    const { error } = await supabase.from("dishes").update({ status: "planned", plan_date: date || null }).eq("id", d.id);
    if (error) setErr(errorText(error)); else onChanged();
  }

  if (!voting.length) {
    return (
      <div className="empty">
        <h2>Ingen afstemninger</h2>
        <p>Foreslå en ret, så kan alle i familien stemme ja eller nej, inden madplanen lægges.</p>
        <button className="btn" onClick={openAdd}>Foreslå en ret</button>
      </div>
    );
  }

  return (
    <>
      {err && <p className="status err" style={{ marginTop: 12 }}>{err}</p>}
      <div className="section">
        {sorted.map((d) => {
          const t = tally(d);
          const ended = !!d.vote_deadline && new Date(d.vote_deadline) <= new Date();
          const missing = data.members.filter((m) => !data.votes.some((v) => v.dish_id === d.id && v.user_id === m.user_id));
          return (
            <DishCard key={d.id} dish={d} data={data} userId={userId} onFill={onFill} onChanged={onChanged}>
              <div className="row">
                <span className={"pill" + (ended ? " off" : "")}>{deadlineText(d.vote_deadline) || "Åben afstemning"}</span>
                {ended && t.yes.length > t.no.length && <span className="pill">Flertal for</span>}
                {ended && t.yes.length <= t.no.length && <span className="pill warn">Intet flertal</span>}
              </div>
              <div className="vote-row">
                <button className="vote yes" aria-pressed={t.mine === 1} disabled={ended} onClick={() => vote(d, 1, t.mine)}>Ja · {t.yes.length}</button>
                <button className="vote no" aria-pressed={t.mine === -1} disabled={ended} onClick={() => vote(d, -1, t.mine)}>Nej · {t.no.length}</button>
              </div>
              <div className="voters">
                {t.yes.length > 0 && <div>Ja: {t.yes.map((v) => nameOf(v.user_id)).join(", ")}</div>}
                {t.no.length > 0 && <div>Nej: {t.no.map((v) => nameOf(v.user_id)).join(", ")}</div>}
                {missing.length > 0 && <div>Mangler: {missing.map((m) => m.display_name).join(", ")}</div>}
              </div>
              {isParent && (
                <label className="field">Sæt på madplanen
                  <select id={`plan-${d.id}`} value="" onChange={(e) => { if (e.target.value) plan(d, e.target.value === "none" ? "" : e.target.value); }}>
                    <option value="">Vælg dag…</option>
                    <option value="none">Ingen bestemt dag</option>
                    {nextDays().map((x) => <option key={x.iso} value={x.iso}>{x.label}</option>)}
                  </select>
                </label>
              )}
            </DishCard>
          );
        })}
      </div>
    </>
  );
}
