import { useEffect, useRef, useState } from "react";
import { callApi, errorText, supabase } from "../lib/supabase";
import type { Dish, Ingredient, ParsedRecipe } from "../lib/types";
import type { FamilyData } from "../lib/useFamily";
import { defaultDeadline, hostOf, imageToDataUrl, nextDays } from "../lib/util";

type Mode = "link" | "text" | "photo" | "idea";

interface Props {
  data: FamilyData;
  userId: string;
  initialUrl?: string;
  /** En ret der allerede findes, men mangler ingredienser. */
  fill?: Dish;
  onClose: () => void;
  onSaved: (where: "planned" | "voting") => void;
}

export function AddDish({ data, userId, initialUrl, fill, onClose, onSaved }: Props) {
  const isParent = data.me?.role === "parent";
  const [mode, setMode] = useState<Mode>(fill?.url || initialUrl ? "link" : fill ? "text" : "link");
  const [url, setUrl] = useState(fill?.url || initialUrl || "");
  const [text, setText] = useState("");
  const [recipe, setRecipe] = useState<ParsedRecipe | null>(null);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [servings, setServings] = useState<number | null>(null);
  const [dest, setDest] = useState<"planned" | "voting">(isParent ? "planned" : "voting");
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; err?: boolean } | null>(null);
  const photo = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  async function fetchRecipe(body: { url?: string; text?: string; image?: string }) {
    setBusy(true); setStatus({ text: "Henter ingredienser…" });
    try {
      const r = await callApi<ParsedRecipe>("/api/recipe", body);
      setRecipe(r); setTitle(fill?.title || r.title); setServings(r.servings); setStatus(null);
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

  function toggleItem(idx: number) {
    if (!recipe) return;
    setRecipe({ ...recipe, items: recipe.items.map((it, i) => (i === idx ? { ...it, off: !it.off } : it)) });
  }

  async function save() {
    setBusy(true); setStatus(null);
    try {
      const items: Ingredient[] = recipe?.items ?? [];
      if (fill) {
        const { error } = await supabase.from("dishes").update({
          items, servings_base: servings, servings, image: fill.image || recipe?.image || null, url: fill.url || url || null,
        }).eq("id", fill.id);
        if (error) throw error;
        onSaved(fill.status === "voting" ? "voting" : "planned");
        return;
      }
      const t = (mode === "idea" ? title : title || recipe?.title || "").trim();
      if (!t) throw new Error("Giv retten et navn.");
      const { error } = await supabase.from("dishes").insert({
        family_id: data.family!.id,
        title: t,
        url: url.trim() || null,
        image: recipe?.image ?? null,
        note: note.trim() || null,
        servings_base: servings, servings,
        items,
        status: dest,
        plan_date: dest === "planned" && day ? day : null,
        vote_deadline: dest === "voting" ? defaultDeadline().toISOString() : null,
        created_by: userId,
      });
      if (error) throw error;
      onSaved(dest);
    } catch (e) { setStatus({ text: errorText(e), err: true }); setBusy(false); }
  }

  const ready = mode === "idea" ? title.trim().length > 0 : !!recipe;

  return (
    <div className="sheet" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>{fill ? `Ingredienser til ${fill.title}` : "Ny ret"}</h2>
          <button className="link" onClick={onClose}>Luk</button>
        </div>

        {!recipe && (
          <>
            <div className="segmented" role="group" aria-label="Hvordan vil du tilføje retten?">
              <button aria-pressed={mode === "link"} onClick={() => { setMode("link"); setStatus(null); }}>Link</button>
              <button aria-pressed={mode === "text"} onClick={() => { setMode("text"); setStatus(null); }}>Tekst</button>
              <button aria-pressed={mode === "photo"} onClick={() => { setMode("photo"); setStatus(null); }}>Foto</button>
              {!fill && <button aria-pressed={mode === "idea"} onClick={() => { setMode("idea"); setUrl(""); setStatus(null); }}>Idé</button>}
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
                <span>Personer</span>
                <button className="step" aria-label="Færre" onClick={() => setServings(Math.max(1, (servings || 1) - 1))}>−</button>
                <b>{servings}</b>
                <button className="step" aria-label="Flere" onClick={() => setServings((servings || 0) + 1)}>+</button>
              </div>
            )}
            <div className="chips">
              {recipe.items.map((it, i) => (
                <span key={i} className={"chip" + (it.off ? " off" : "")}>{it.name}
                  <button aria-label={(it.off ? "Tilbage på listen: " : "Har vi: ") + it.name} onClick={() => toggleItem(i)}>{it.off ? "↺" : "×"}</button>
                </span>
              ))}
            </div>
            <p className="muted small" style={{ margin: 0 }}>Tryk × på det, I allerede har derhjemme.</p>
          </div>
        )}

        {ready && !fill && (
          <div className="stack">
            {isParent ? (
              <div className="segmented" role="group" aria-label="Hvor skal retten hen?">
                <button aria-pressed={dest === "planned"} onClick={() => setDest("planned")}>På madplanen</button>
                <button aria-pressed={dest === "voting"} onClick={() => setDest("voting")}>Til afstemning</button>
              </div>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>Retten kommer til afstemning, så hele familien kan stemme.</p>
            )}
            {dest === "planned" && (
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
          <button className="btn ghost" onClick={() => { setMode("idea"); setTitle(hostOf(url.trim())); setStatus(null); }}>Gem linket uden ingredienser</button>
        )}

        {ready && (
          <div className="row end">
            {recipe && <button className="btn ghost" disabled={busy} onClick={() => { setRecipe(null); setStatus(null); }}>Start forfra</button>}
            <button className="btn" disabled={busy} onClick={save}>
              {fill ? "Gem ingredienser" : dest === "voting" ? "Send til afstemning" : "Sæt på madplanen"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
