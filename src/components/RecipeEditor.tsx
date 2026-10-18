import { useState } from "react";
import { fmt } from "../lib/merge";
import { callApi, errorText, supabase } from "../lib/supabase";
import type { Ingredient, ParsedRecipe, Recipe } from "../lib/types";
import type { FamilyData } from "../lib/useFamily";

interface Props {
  data: FamilyData;
  userId: string;
  /** Opskriften, der redigeres. Uden den oprettes en ny. */
  recipe?: Recipe;
  onClose: () => void;
  onSaved: () => void;
}

const lineOf = (i: Ingredient) => [i.qty != null ? fmt(i.qty) : "", i.unit, i.name].filter(Boolean).join(" ");

/** Skriv en egen opskrift eller ret en eksisterende. Ingredienserne skrives frit og læses af Claude. */
export function RecipeEditor({ data, userId, recipe, onClose, onSaved }: Props) {
  const isParent = data.me?.role === "parent";
  const initialLines = recipe?.items.map(lineOf).join("\n") ?? "";
  const [title, setTitle] = useState(recipe?.title ?? "");
  const [servings, setServings] = useState<number>(recipe?.servings_base ?? 4);
  const [lines, setLines] = useState(initialLines);
  const [instructions, setInstructions] = useState(recipe?.instructions ?? "");
  const [parsed, setParsed] = useState<{ items: Ingredient[]; kcal: number | null } | null>(
    recipe ? { items: recipe.items, kcal: recipe.kcal_per_serving } : null);
  const [parsedFrom, setParsedFrom] = useState(recipe ? initialLines : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const needsReading = lines.trim() !== "" && parsedFrom !== lines;

  async function read() {
    setBusy(true); setErr("");
    try {
      const r = await callApi<ParsedRecipe>("/api/recipe", {
        text: `Opskrift: ${title || "Egen opskrift"}\nAntal personer: ${servings}\nIngredienser:\n${lines}\n\n(Fremgangsmåden er skrevet separat, så sæt instructions til null.)`,
      });
      setParsed({ items: r.items, kcal: r.kcal_per_serving });
      setParsedFrom(lines);
    } catch (e) { setErr(errorText(e)); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!title.trim()) { setErr("Giv opskriften et navn."); return; }
    setBusy(true); setErr("");
    // Kalorier pr. person følger antallet af personer, hvis ingredienserne er de samme.
    let kcal = parsed?.kcal ?? null;
    if (kcal && recipe?.servings_base && parsedFrom === initialLines && recipe.servings_base !== servings) {
      kcal = Math.round((kcal * recipe.servings_base) / servings / 10) * 10;
    }
    const row = {
      title: title.trim(), servings_base: servings, items: parsed?.items ?? [],
      kcal_per_serving: kcal, instructions: instructions.trim() || null,
    };
    const { error } = recipe
      ? await supabase.from("recipes").update(row).eq("id", recipe.id)
      : await supabase.from("recipes").insert({ ...row, family_id: data.family!.id, created_by: userId, suggested: !isParent });
    setBusy(false);
    if (error) setErr(errorText(error)); else onSaved();
  }

  return (
    <div className="sheet" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>{recipe ? "Ret opskrift" : "Egen opskrift"}</h2>
          <button className="link" onClick={onClose}>Luk</button>
        </div>

        <label className="field">Navn
          <input id="recipe-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fx Mormors frikadeller" />
        </label>

        <div className="serv">
          <span>Til</span>
          <button className="step" aria-label="Færre" onClick={() => setServings(Math.max(1, servings - 1))}>−</button>
          <b>{servings}</b>
          <button className="step" aria-label="Flere" onClick={() => setServings(servings + 1)}>+</button>
          <span>personer</span>
        </div>

        <label className="field">Ingredienser, én pr. linje
          <textarea id="recipe-lines" value={lines} onChange={(e) => setLines(e.target.value)}
            placeholder={"500 g hakket svinekød\n1 løg\n2 æg\n1 dl mælk\nsalt og peber"} style={{ minHeight: 160 }} />
        </label>

        {parsed && !needsReading && parsed.items.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="chips">
              {parsed.items.map((it, i) => (
                <span key={i} className="chip">{it.name}
                  <button aria-label={`Fjern ${it.name}`} onClick={() => setParsed({ ...parsed, items: parsed.items.filter((_, j) => j !== i) })}>×</button>
                </span>
              ))}
            </div>
            {parsed.kcal && <span className="muted small">Ca. {parsed.kcal} kcal pr. person</span>}
          </div>
        )}

        <label className="field">Fremgangsmåde (valgfri)
          <textarea id="recipe-steps" value={instructions} onChange={(e) => setInstructions(e.target.value)}
            placeholder={"1. Rør farsen med løg, æg og mælk.\n2. Steg frikadellerne 5 min på hver side."} style={{ minHeight: 120 }} />
        </label>

        {err && <p className="status err">{err}</p>}

        <div className="row end">
          {needsReading ? (
            <button className="btn" disabled={busy || !title.trim()} onClick={read}>{busy ? "Læser ingredienser…" : "Læs ingredienser"}</button>
          ) : (
            <button className="btn" disabled={busy || !title.trim()} onClick={save}>{isParent || recipe ? "Gem opskrift" : "Send forslag"}</button>
          )}
        </div>
        {needsReading && <p className="muted small" style={{ margin: 0 }}>Ingredienserne læses, sorteres efter afdeling og får et kalorieskøn, før opskriften gemmes.</p>}
      </div>
    </div>
  );
}
