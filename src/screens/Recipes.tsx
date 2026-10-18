import { useState } from "react";
import type { FillTarget } from "../components/AddDish";
import { planRecipe } from "../lib/actions";
import { errorText, supabase } from "../lib/supabase";
import type { Recipe } from "../lib/types";
import type { FamilyData } from "../lib/useFamily";
import { dayLabel, hostOf, nextDays } from "../lib/util";

interface Props {
  data: FamilyData;
  userId: string;
  onChanged: () => void;
  openAdd: () => void;
  onFill: (t: FillTarget) => void;
  goTo: (tab: "plan" | "vote") => void;
}

export function Recipes({ data, userId, onChanged, openAdd, onFill, goTo }: Props) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = data.recipes.filter((r) => !q || r.title.toLowerCase().includes(q) || r.items.some((i) => i.name.includes(q)));
  const suggestions = matches.filter((r) => r.suggested);
  const list = matches.filter((r) => !r.suggested);

  if (!data.recipes.length) {
    return (
      <div className="empty">
        <h2>Ingen opskrifter endnu</h2>
        <p>Gem opskrifter fra links, tekst eller fotos af kogebøger. Herfra lægges de på madplanen, igen og igen. Børnenes forslag kommer også her.</p>
        <button className="btn" onClick={openAdd}>Tilføj opskrift</button>
      </div>
    );
  }

  return (
    <>
      <div style={{ marginTop: 16 }}>
        <input id="search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Søg i ${data.recipes.length} opskrifter eller ingredienser`} autoComplete="off" />
      </div>
      {!matches.length && <p className="muted" style={{ marginTop: 16 }}>Ingen opskrifter matcher "{query}".</p>}
      {suggestions.length > 0 && (
        <div className="section">
          <span className="sign">Forslag<small>{suggestions.length}</small></span>
          <div style={{ marginTop: 8 }}>
            {suggestions.map((r) => <RecipeCard key={r.id} recipe={r} data={data} userId={userId} onChanged={onChanged} onFill={onFill} goTo={goTo} />)}
          </div>
        </div>
      )}
      <div className="section">
        {list.map((r) => <RecipeCard key={r.id} recipe={r} data={data} userId={userId} onChanged={onChanged} onFill={onFill} goTo={goTo} />)}
      </div>
    </>
  );
}

function RecipeCard({ recipe: r, data, userId, onChanged, onFill, goTo }: { recipe: Recipe } & Omit<Props, "openAdd">) {
  const isParent = data.me?.role === "parent";
  const canEdit = isParent || r.created_by === userId;
  const [panel, setPanel] = useState<"none" | "plan" | "items" | "delete">("none");
  const [day, setDay] = useState("");
  const [servings, setServings] = useState<number | null>(r.servings_base);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const onPlan = data.dishes.filter((d) => d.recipe_id === r.id && d.status === "planned");
  const author = data.members.find((m) => m.user_id === r.created_by)?.display_name;

  async function run(fn: () => Promise<void>, then?: () => void) {
    setBusy(true); setErr("");
    try { await fn(); onChanged(); setPanel("none"); then?.(); }
    catch (e) { setErr(errorText(e)); }
    finally { setBusy(false); }
  }

  return (
    <article className={"card" + (r.suggested ? " suggest" : "")}>
      <div className="card-head">
        {r.image && <img src={r.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => { (e.target as HTMLImageElement).hidden = true; }} />}
        <div className="main">
          <h3>{r.title}</h3>
          <span className="muted small">
            {[r.items.length ? `${r.items.length} ingredienser` : "Ingen ingredienser endnu", r.servings_base && `${r.servings_base} pers.`, author].filter(Boolean).join(" · ")}
          </span>
          {r.url && <a className="small" href={r.url} target="_blank" rel="noopener noreferrer">{hostOf(r.url)}</a>}
          {(onPlan.length > 0 || r.suggested) && (
            <div className="row" style={{ marginTop: 2 }}>
              {r.suggested && <span className="pill warn">Forslag fra {author ?? "familien"}</span>}
              {onPlan.map((d) => <span key={d.id} className="pill">{d.plan_date ? dayLabel(d.plan_date) : "På madplanen"}</span>)}
            </div>
          )}
        </div>
      </div>

      <div className="row">
        {isParent && <button className="btn small" disabled={busy} onClick={() => setPanel(panel === "plan" ? "none" : "plan")}>Læg på madplanen</button>}
        {isParent && r.suggested && (
          <button className="btn ghost small" disabled={busy} onClick={() => run(async () => {
            const { error } = await supabase.from("recipes").update({ suggested: false }).eq("id", r.id);
            if (error) throw error;
          })}>Ikke nu</button>
        )}
        {r.items.length > 0 && <button className="link" onClick={() => setPanel(panel === "items" ? "none" : "items")}>{panel === "items" ? "Skjul" : "Ingredienser"}</button>}
        {canEdit && r.items.length === 0 && <button className="btn ghost small" onClick={() => onFill({ kind: "recipe", recipe: r })}>Hent ingredienser</button>}
      </div>

      {panel === "plan" && (
        <div className="stack">
          <label className="field">Dag
            <select id={`plan-day-${r.id}`} value={day} onChange={(e) => setDay(e.target.value)}>
              <option value="">Ingen bestemt dag</option>
              {nextDays().map((d) => <option key={d.iso} value={d.iso}>{d.label}</option>)}
            </select>
          </label>
          {servings != null && (
            <div className="serv">
              <span>Personer</span>
              <button className="step" aria-label="Færre" onClick={() => setServings(Math.max(1, (servings || 1) - 1))}>−</button>
              <b>{servings}</b>
              <button className="step" aria-label="Flere" onClick={() => setServings((servings || 0) + 1)}>+</button>
            </div>
          )}
          <div className="row end">
            <button className="btn ghost" onClick={() => setPanel("none")}>Fortryd</button>
            <button className="btn" disabled={busy} onClick={() => run(async () => {
              await planRecipe(r, userId, { status: "planned", date: day, servings });
              if (r.suggested) await supabase.from("recipes").update({ suggested: false }).eq("id", r.id);
            }, () => goTo("plan"))}>Sæt på madplanen</button>
          </div>
        </div>
      )}

      {panel === "items" && (
        <div className="chips">
          {r.items.map((it, i) => <span key={i} className="chip" style={{ paddingRight: 10 }}>{it.name}</span>)}
        </div>
      )}

      {err && <p className="status err">{err}</p>}

      {canEdit && panel !== "delete" && (
        <div className="row end"><button className="link" onClick={() => setPanel("delete")}>Slet opskrift</button></div>
      )}
      {panel === "delete" && (
        <div className="row end">
          <span className="small muted">Slette {r.title} fra opskrifterne?</span>
          <button className="btn ghost small" onClick={() => setPanel("none")}>Behold</button>
          <button className="btn danger small" disabled={busy} onClick={() => run(async () => {
            const { error } = await supabase.from("recipes").delete().eq("id", r.id);
            if (error) throw error;
          })}>Slet</button>
        </div>
      )}
    </article>
  );
}
