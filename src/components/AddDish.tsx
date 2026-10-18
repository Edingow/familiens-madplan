import { useEffect, useRef, useState } from "react";
import { planRecipe } from "../lib/actions";
import { callApi, errorText, supabase } from "../lib/supabase";
import type { Dish, ParsedRecipe, Recipe } from "../lib/types";
import type { FamilyData } from "../lib/useFamily";
import { hostOf, imageToDataUrl, nextDays } from "../lib/util";

type Mode = "link" | "text" | "photo" | "idea";
export type Where = "recipes" | "planned" | "voting";
export type FillTarget = { kind: "dish"; dish: Dish } | { kind: "recipe"; recipe: Recipe };

interface Props {
  data: FamilyData;
  userId: string;
  initialUrl?: string;
  /** En ret eller opskrift, der allerede findes, men mangler ingredienser. */
  fill?: FillTarget;
  onClose: () => void;
  onSaved: (where: Where) => void;
}

export function AddDish({ data, userId, initialUrl, fill, onClose, onSaved }: Props) {
  const isParent = data.me?.role === "parent";
  const fillTitle = fill?.kind === "dish" ? fill.dish.title : fill?.recipe.title;
  const fillUrl = (fill?.kind === "dish" ? fill.dish.url : fill?.recipe.url) || "";
  const [mode, setMode] = useState<Mode>(fill && !fillUrl ? "text" : "link");
  const [url, setUrl] = useState(fillUrl || initialUrl || "");
  const [text, setText] = useState("");
  const [recipe, setRecipe] = useState<ParsedRecipe | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [servings, setServings] = useState<number | null>(null);
  const [dest, setDest] = useState<Where>("recipes");
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; err?: boolean } | null>(null);
  const photo = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  async function fetchRecipe(body: { url?: string; text?: string; image?: string }) {
    setBusy(true); setStatus({ text: "Henter ingredienser…" });
    try {
      const r = await callApi<ParsedRecipe>("/api/recipe", body);
      setRecipe(r); setTitle(fillTitle || r.title); setServings(r.servings); setStatus(null);
    } catch (e) { setStatus({ text: errorText(e), err: true }); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (initialUrl && !started.current) { started.current = true; fetchRecipe({ url: initialUrl }); }
  }, [initialUrl]);

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) fetchRecipe({ image: await imageToDataUrl(f, 1800) });
  }

  function removeItem(idx: number) {
    if (recipe) setRecipe({ ...recipe, items: recipe.items.filter((_, i) => i !== idx) });
  }

  async function saveFill() {
    const items = recipe!.items;
    const base = { items, servings_base: servings, kcal_per_serving: recipe!.kcal_per_serving, nutrition: recipe!.nutrition ?? null };
    const recipeExtra = recipe!.instructions ? { instructions: recipe!.instructions } : {};
    if (fill!.kind === "recipe") {
      const r = fill!.recipe;
      const { error } = await supabase.from("recipes").update({ ...base, ...recipeExtra, image: recipe!.image || r.image, url: r.url || url.trim() || null }).eq("id", r.id);
      if (error) throw error;
      onSaved("recipes");
      return;
    }
    const d = fill!.dish;
    let recipeId = d.recipe_id;
    if (recipeId) {
      const { error } = await supabase.from("recipes").update({ ...base, ...recipeExtra }).eq("id", recipeId);
      if (error) throw error;
    } else {
      const { data: row, error } = await supabase.from("recipes").insert({
        family_id: d.family_id, title: d.title, url: d.url || url.trim() || null, image: d.image || recipe!.image,
        note: d.note, created_by: userId, ...base, ...recipeExtra,
      }).select("id").single();
      if (error) throw error;
      recipeId = row.id;
    }
    const { error } = await supabase.from("dishes").update({
      ...base, servings, recipe_id: recipeId, image: d.image || recipe!.image, url: d.url || url.trim() || null,
    }).eq("id", d.id);
    if (error) throw error;
    onSaved("planned");
  }

  async function save() {
    setBusy(true); setStatus(null);
    try {
      if (fill) { await saveFill(); return; }

      if (mode === "idea" && isParent) {
        const t = title.trim();
        if (!t) throw new Error("Skriv, hvad I skal have.");
        const { error } = await supabase.from("dishes").insert({
          family_id: data.family!.id, title: t, url: url.trim() || null, note: note.trim() || null, items: [],
          status: "planned", plan_date: day || null, created_by: userId,
        });
        if (error) throw error;
        onSaved("planned");
        return;
      }

      const t = (title || recipe?.title || "").trim();
      if (!t) throw new Error(mode === "idea" ? "Skriv, hvad I skal have." : "Giv opskriften et navn.");
      const { data: row, error } = await supabase.from("recipes").insert({
        family_id: data.family!.id, title: t, url: url.trim() || null, image: recipe?.image ?? null,
        note: note.trim() || null, servings_base: servings, items: recipe?.items ?? [], created_by: userId,
        suggested: !isParent, kcal_per_serving: recipe?.kcal_per_serving ?? null, instructions: recipe?.instructions ?? null,
        nutrition: recipe?.nutrition ?? null,
      }).select("*").single();
      if (error) throw error;
      if (isParent && dest === "planned") { await planRecipe(row as Recipe, userId, { status: "planned", date: day, servings }); onSaved("planned"); }
      else onSaved("recipes");
    } catch (e) { setStatus({ text: errorText(e), err: true }); setBusy(false); }
  }

  const ready = mode === "idea" ? title.trim().length > 0 : !!recipe;
  const switchMode = (m: Mode) => { setMode(m); setStatus(null); if (m === "idea" && isParent) setDest("planned"); };

  const destOptions: { value: Where; label: string }[] = isParent && mode !== "idea"
    ? [{ value: "recipes", label: "Kun gem" }, { value: "planned", label: "+ Madplan" }]
    : [];

  const saveLabel = fill ? "Gem ingredienser"
    : !isParent ? "Send forslag"
    : mode === "idea" ? "Sæt på madplanen"
    : dest === "planned" ? "Gem og sæt på madplanen" : "Gem i opskrifter";

  return (
    <div className="sheet" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>{fill ? `Ingredienser til ${fillTitle}` : "Ny opskrift"}</h2>
          <button className="link" onClick={onClose}>Luk</button>
        </div>

        {!recipe && (
          <>
            <div className="segmented" role="group" aria-label="Hvordan vil du tilføje?">
              <button aria-pressed={mode === "link"} onClick={() => switchMode("link")}>Link</button>
              <button aria-pressed={mode === "text"} onClick={() => switchMode("text")}>Tekst</button>
              <button aria-pressed={mode === "photo"} onClick={() => switchMode("photo")}>Foto</button>
              {!fill && <button aria-pressed={mode === "idea"} onClick={() => { setUrl(""); switchMode("idea"); }}>Idé</button>}
            </div>

            {mode === "link" && (
              <form className="stack" onSubmit={(e) => { e.preventDefault(); if (url.trim()) fetchRecipe({ url: url.trim() }); }}>
                <label className="field">Link til opskriften
                  <input id="url" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" autoComplete="off" />
                </label>
                <button className="btn" disabled={busy || !url.trim()}>Hent ingredienser</button>
              </form>
            )}
            {mode === "text" && (
              <form className="stack" onSubmit={(e) => { e.preventDefault(); if (text.trim()) fetchRecipe({ text }); }}>
                <label className="field">Indsæt opskriften
                  <textarea id="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Kopiér ingredienslisten eller hele siden og indsæt her." />
                </label>
                <button className="btn" disabled={busy || text.trim().length < 6}>Hent ingredienser</button>
              </form>
            )}
            {mode === "photo" && (
              <div className="stack">
                <p className="muted" style={{ margin: 0 }}>Tag et billede af ingredienslisten i en kogebog eller på et blad.</p>
                <button className="btn" disabled={busy} onClick={() => photo.current?.click()}>Tag billede</button>
                <input ref={photo} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
              </div>
            )}
            {mode === "idea" && (
              <div className="stack">
                <p className="muted small" style={{ margin: 0 }}>{isParent ? "En idé uden opskrift går direkte på madplanen." : "Din idé bliver et forslag under Opskrifter."}</p>
                <label className="field">Hvad skal vi have?
                  <input id="idea" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fx tacos" />
                </label>
                <label className="field">Note (valgfri)
                  <input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Fx med hjemmelavet guacamole" />
                </label>
              </div>
            )}
          </>
        )}

        {recipe && (
          <div className="stack">
            {!fill && (
              <label className="field">Navn
                <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
            )}
            {servings != null && (
              <div className="serv">
                <span>Opskriften er til</span>
                <button className="step" aria-label="Færre" onClick={() => setServings(Math.max(1, (servings || 1) - 1))}>−</button>
                <b>{servings}</b>
                <button className="step" aria-label="Flere" onClick={() => setServings((servings || 0) + 1)}>+</button>
                <span>personer</span>
              </div>
            )}
            <div className="chips">
              {recipe.items.map((it, i) => (
                <span key={i} className="chip">{it.name}
                  <button aria-label={`Fjern ${it.name}`} onClick={() => removeItem(i)}>×</button>
                </span>
              ))}
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              {recipe.kcal_per_serving ? `Ca. ${recipe.kcal_per_serving} kcal pr. person. ` : ""}Tryk × for at fjerne noget, der er læst forkert.
            </p>
          </div>
        )}

        {ready && !fill && (
          <div className="stack">
            {destOptions.length > 1 && (
              <div className="segmented" role="group" aria-label="Hvad skal der ske med den?">
                {destOptions.map((o) => <button key={o.value} aria-pressed={dest === o.value} onClick={() => setDest(o.value)}>{o.label}</button>)}
              </div>
            )}
            {!isParent && <p className="muted small" style={{ margin: 0 }}>Opskriften gemmes som dit forslag, så mor og far kan se den.</p>}
            {isParent && dest === "planned" && (
              <label className="field">Dag
                <select id="day" value={day} onChange={(e) => setDay(e.target.value)}>
                  <option value="">Ingen bestemt dag</option>
                  {nextDays().map((d) => <option key={d.iso} value={d.iso}>{d.label}</option>)}
                </select>
              </label>
            )}
          </div>
        )}

        {status && <p className={"status" + (status.err ? " err" : "")}>{status.text}</p>}
        {status?.err && mode === "link" && !recipe && !fill && url.trim() && (
          <button className="btn ghost" onClick={() => { const u = url; switchMode("idea"); setUrl(u); setTitle(hostOf(u.trim())); }}>Gem linket uden ingredienser</button>
        )}

        {ready && (
          <div className="row end">
            {recipe && <button className="btn ghost" disabled={busy} onClick={() => { setRecipe(null); setStatus(null); }}>Start forfra</button>}
            <button className="btn" disabled={busy} onClick={save}>{saveLabel}</button>
          </div>
        )}
      </div>
    </div>
  );
}
