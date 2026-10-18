import { useEffect, useState } from "react";
import { callApi, errorText, supabase } from "../lib/supabase";
import type { Dish, ParsedRecipe, Vote } from "../lib/types";
import type { FamilyData } from "../lib/useFamily";
import { dayLabel } from "../lib/util";

interface Props { data: FamilyData; userId: string; onChanged: () => void; goTo: (tab: "plan" | "recipes") => void }

/** Afstemning om ugens madplan: marker det, du ikke har lyst til, skriv hvorfor, og foreslå noget andet. */
export function Voting({ data, userId, onChanged, goTo }: Props) {
  const [err, setErr] = useState("");
  const open = !!data.family?.plan_vote_open;
  const planned = data.dishes
    .filter((d) => d.status === "planned")
    .sort((a, b) => (a.plan_date ?? "9999").localeCompare(b.plan_date ?? "9999"));
  const reviewedByMe = data.reviews.some((r) => r.user_id === userId);

  if (!open || !planned.length) {
    return (
      <div className="empty">
        <h2>Ingen afstemning lige nu</h2>
        <p>Når mor eller far sender ugens madplan til afstemning, kan du her markere de retter, du ikke har lyst til, skrive hvorfor og foreslå noget andet.</p>
        <button className="btn" onClick={() => goTo("plan")}>Se madplanen</button>
      </div>
    );
  }

  async function setReviewed(on: boolean) {
    setErr("");
    const { error } = on
      ? await supabase.from("plan_reviews").insert({ family_id: data.family!.id, user_id: userId })
      : await supabase.from("plan_reviews").delete().eq("user_id", userId);
    if (error) setErr(errorText(error)); else onChanged();
  }

  return (
    <>
      <p className="muted" style={{ margin: "16px 0 0" }}>
        Tryk <b>Ikke for mig</b> ved de retter, du ikke har lyst til. Skriv gerne hvorfor, og foreslå en anden ret.
      </p>
      <div className="section">
        {planned.map((d) => <VoteCard key={d.id} dish={d} data={data} userId={userId} onChanged={onChanged} />)}
      </div>
      <div className="section stack">
        {reviewedByMe ? (
          <div className="row">
            <span className="pill">Du har sagt din mening</span>
            <button className="link" onClick={() => setReviewed(false)}>Fortryd</button>
          </div>
        ) : (
          <button className="btn" onClick={() => setReviewed(true)}>Færdig, jeg har kigget madplanen igennem</button>
        )}
        {err && <p className="status err">{err}</p>}
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
  const [suggestMode, setSuggestMode] = useState<"none" | "recipe" | "link">("none");
  const [link, setLink] = useState("");
  useEffect(() => { setComment(mine?.comment ?? ""); }, [mine?.comment]);

  const nameOf = (v: Vote) => data.members.find((m) => m.user_id === v.user_id)?.display_name ?? "Ukendt";
  const recipeTitle = (id: string | null) => data.recipes.find((r) => r.id === id)?.title;
  const plannedRecipeIds = new Set(data.dishes.filter((d) => d.status === "planned").map((d) => d.recipe_id));
  const options = data.recipes.filter((r) => !plannedRecipeIds.has(r.id));

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr("");
    try { await fn(); onChanged(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  }
  const updateMine = async (p: Partial<Vote>) => {
    const { error } = await supabase.from("votes").update(p).eq("dish_id", dish.id).eq("user_id", userId);
    if (error) throw error;
  };

  const toggle = () => run(async () => {
    const { error } = mine
      ? await supabase.from("votes").delete().eq("dish_id", dish.id).eq("user_id", userId)
      : await supabase.from("votes").upsert({ dish_id: dish.id, user_id: userId, value: -1, comment: null, suggestion_recipe_id: null });
    if (error) throw error;
    setComment(""); setSuggestMode("none");
  });

  const saveComment = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => { await updateMine({ comment: comment.trim() || null }); setSaved(true); setTimeout(() => setSaved(false), 1500); });
  };

  const suggestRecipe = (id: string) => run(async () => { await updateMine({ suggestion_recipe_id: id || null }); setSuggestMode("none"); });

  /** Nyt link: hent opskriften, gem den som forslag i Opskrifter, og peg på den. */
  const suggestLink = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await callApi<ParsedRecipe>("/api/recipe", { url: link.trim() });
      const { data: row, error } = await supabase.from("recipes").insert({
        family_id: data.family!.id, title: r.title, url: link.trim(), image: r.image, servings_base: r.servings,
        items: r.items, created_by: userId, suggested: true,
      }).select("id").single();
      if (error) throw error;
      await updateMine({ suggestion_recipe_id: row.id });
      setLink(""); setSuggestMode("none");
    });
  };

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
        <div className="stack" style={{ gap: 8 }}>
          <form className="row" style={{ flexWrap: "nowrap" }} onSubmit={saveComment}>
            <input id={`comment-${dish.id}`} value={comment} maxLength={200} onChange={(e) => setComment(e.target.value)} placeholder="Hvorfor? Fx for stærk, fik det i går" autoComplete="off" />
            <button className="btn small" disabled={busy || comment.trim() === (mine.comment ?? "")}>{saved ? "Gemt" : "Gem"}</button>
          </form>

          {mine.suggestion_recipe_id && recipeTitle(mine.suggestion_recipe_id) ? (
            <div className="row">
              <span className="small">Du foreslår <b>{recipeTitle(mine.suggestion_recipe_id)}</b></span>
              <button className="link" disabled={busy} onClick={() => suggestRecipe("")}>Fjern forslag</button>
            </div>
          ) : suggestMode === "none" ? (
            <div className="row">
              <span className="small muted">Foreslå noget andet:</span>
              <button className="btn ghost small" onClick={() => setSuggestMode("recipe")}>Fra opskrifter</button>
              <button className="btn ghost small" onClick={() => setSuggestMode("link")}>Nyt link</button>
            </div>
          ) : suggestMode === "recipe" ? (
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <select id={`suggest-${dish.id}`} defaultValue="" disabled={busy} onChange={(e) => e.target.value && suggestRecipe(e.target.value)}>
                <option value="">{options.length ? "Vælg en opskrift…" : "Ingen andre opskrifter endnu"}</option>
                {options.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </select>
              <button className="link" onClick={() => setSuggestMode("none")}>Fortryd</button>
            </div>
          ) : (
            <form className="stack" style={{ gap: 6 }} onSubmit={suggestLink}>
              <input id={`link-${dish.id}`} type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link til en opskrift" autoComplete="off" />
              <div className="row end">
                <button type="button" className="link" onClick={() => setSuggestMode("none")}>Fortryd</button>
                <button className="btn small" disabled={busy || !link.trim()}>{busy ? "Henter…" : "Foreslå"}</button>
              </div>
            </form>
          )}
        </div>
      )}

      {others.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          {others.map((v) => (
            <div key={v.user_id} className="small">
              <b>{nameOf(v)}</b>: ikke for mig{v.comment ? ` · "${v.comment}"` : ""}
              {recipeTitle(v.suggestion_recipe_id) ? ` · foreslår ${recipeTitle(v.suggestion_recipe_id)}` : ""}
            </div>
          ))}
        </div>
      )}
      {err && <p className="status err">{err}</p>}
    </article>
  );
}
