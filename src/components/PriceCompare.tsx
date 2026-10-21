import { useEffect, useMemo, useRef, useState } from "react";
import { needOf, type ListItem } from "../lib/merge";
import {
  basketsByStore, cheapestBasket, kr, readPrefs, STORES, storeName,
  type ItemPrices, type Line, type Need, type PricesResponse, type ShopPrefs, type StoreId,
} from "../lib/shop";
import { callApi, errorText, supabase } from "../lib/supabase";
import type { FamilyData } from "../lib/useFamily";

interface Props { data: FamilyData; items: ListItem[]; onClose: () => void; onChanged: () => void }

type View = { kind: "overview" } | { kind: "store"; store: StoreId } | { kind: "cheapest" } | { kind: "prefs" };

const CHUNK = 6;
const PARALLEL = 3;
const CACHE = "priser-v1";

/** "Se priser og køb online": hvad kurven koster i hver butik, og den billigste kurv på tværs af kæderne. */
export function PriceCompare({ data, items, onClose, onChanged }: Props) {
  const isParent = data.me?.role === "parent";
  const prefs = readPrefs(data.family?.shop_prefs);
  const needs: Need[] = useMemo(
    () => items.filter((i) => prefs.includeBasics || i.category !== "basic").map(needOf),
    [items, prefs.includeBasics],
  );
  const signature = JSON.stringify([needs.map((n) => [n.key, n.g, n.ml, n.stk]), prefs]);

  const [view, setView] = useState<View>({ kind: "overview" });
  const [result, setResult] = useState<PricesResponse | null>(() => {
    try { const c = JSON.parse(sessionStorage.getItem(CACHE) || "null"); return c?.sig === signature ? c.res : null; } catch { return null; }
  });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState("");
  const run = useRef(0);

  async function load() {
    const id = ++run.current;
    setErr(""); setResult(null);
    if (!needs.length || !prefs.stores.length) return;
    const chunks: Need[][] = [];
    for (let i = 0; i < needs.length; i += CHUNK) chunks.push(needs.slice(i, i + CHUNK));
    const all: ItemPrices[] = [];
    const errors: PricesResponse["errors"] = {};
    let failed = 0, next = 0, done = 0;
    setProgress({ done: 0, total: needs.length });
    const worker = async () => {
      while (next < chunks.length) {
        const chunk = chunks[next++];
        try {
          const r = await callApi<PricesResponse>("/api/prices", { needs: chunk, prefs, stores: prefs.stores });
          all.push(...r.items); Object.assign(errors, r.errors);
        } catch (e) { failed++; setErr(errorText(e)); }
        done += chunk.length;
        if (id === run.current) setProgress({ done, total: needs.length });
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    if (id !== run.current) return;
    setProgress(null);
    if (failed === chunks.length) return;
    const res = { items: all, errors };
    setResult(res);
    try { sessionStorage.setItem(CACHE, JSON.stringify({ sig: signature, res })); } catch { /* ignorer */ }
  }

  useEffect(() => { if (!result) load(); return () => { run.current++; }; }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  const baskets = result ? basketsByStore(needs, result.items, prefs.stores, result.errors) : [];
  const cheapest = result ? cheapestBasket(needs, result.items) : null;

  let body: React.ReactNode;
  if (view.kind === "prefs") {
    body = <PrefsEditor prefs={prefs} isParent={isParent} familyId={data.family!.id}
      onDone={(changed) => { setView({ kind: "overview" }); if (changed) onChanged(); }} />;
  } else if (view.kind === "store") {
    const b = baskets.find((x) => x.store === view.store);
    body = b ? <Checklist title={`Bestil hos ${storeName(b.store)}`} groups={[{ store: b.store, picks: b.found }]} missing={b.missing}
      result={result!} onBack={() => setView({ kind: "overview" })} /> : null;
  } else if (view.kind === "cheapest" && cheapest) {
    const groups = cheapest.byStore.map((s) => ({ store: s.store, picks: cheapest.picks.filter((p) => p.line.product.store === s.store) }));
    body = <Checklist title="Billigste kurv" groups={groups} missing={cheapest.missing} result={result!} onBack={() => setView({ kind: "overview" })} />;
  } else {
    body = (
      <div className="stack">
        <button className="card" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => setView({ kind: "prefs" })}>
          <span className="row" style={{ justifyContent: "space-between", width: "100%" }}>
            <span className="small">
              <b>Præferencer</b><br />
              <span className="muted">
                {prefs.organic === "ignore" ? "Billigst" : prefs.organic === "prefer" ? "Økologi når muligt" : "Kun økologi"}
                {prefs.favoriteBrands.length ? ` · Foretrækker ${prefs.favoriteBrands.join(", ")}` : ""}
                {prefs.blockedBrands.length ? ` · Undgår ${prefs.blockedBrands.join(", ")}` : ""}
                {` · ${prefs.stores.length} butikker`}
              </span>
            </span>
            <span className="muted">›</span>
          </span>
        </button>

        {!needs.length && <p className="muted" style={{ margin: 0 }}>Der er ingen varer tilbage at købe på listen.</p>}
        {progress && (
          <div className="card">
            <div className="small">Finder varerne i butikkerne … {progress.done} af {progress.total}</div>
            <div className="progress" style={{ margin: 0 }}><div className="bar"><i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div></div>
          </div>
        )}
        {err && <p className="status err">{err}</p>}

        {cheapest && cheapest.picks.length > 0 && (
          <div className="card" style={{ borderColor: "var(--green)" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b>Billigste kurv</b><span style={{ fontWeight: 700, fontSize: "1.1rem" }}>{kr(cheapest.total)}</span>
            </div>
            <div className="small muted">
              Hver vare købt, hvor den er billigst. {cheapest.picks.length} af {needs.length} varer fordelt på {cheapest.byStore.length} {cheapest.byStore.length === 1 ? "butik" : "butikker"}.
            </div>
            <div className="small">{cheapest.byStore.map((s) => <div key={s.store}>{storeName(s.store)}: {s.count} {s.count === 1 ? "vare" : "varer"} · {kr(s.total)}</div>)}</div>
            <div className="row"><button className="btn small" onClick={() => setView({ kind: "cheapest" })}>Se varerne</button></div>
          </div>
        )}

        {baskets.map((b) => (
          <div className="card" key={b.store}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span><b>{storeName(b.store)}</b> <span className="muted small">{STORES.find((s) => s.id === b.store)?.note}</span></span>
              <span style={{ fontWeight: 700 }}>{b.failed && !b.found.length ? "–" : kr(b.total)}</span>
            </div>
            {b.failed && !b.found.length ? (
              <div className="small muted">{b.failed}. Prøv igen senere.</div>
            ) : (
              <>
                <div className="small">
                  <span className={b.missing.length ? "pill warn" : "pill"}>{b.found.length} af {needs.length} varer</span>
                  {cheapest && cheapest.missing.length < b.missing.length && b.found.length > 0 && (
                    <span className="muted"> · Prisen er for de fundne varer</span>
                  )}
                </div>
                {b.missing.length > 0 && <div className="small muted">Mangler: {b.missing.map((m) => m.name).join(", ")}</div>}
                {b.found.length > 0 && <div className="row"><button className="btn small" onClick={() => setView({ kind: "store", store: b.store })}>Bestil hos {storeName(b.store)}</button></div>}
              </>
            )}
          </div>
        ))}

        {result && (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <button className="link" style={{ padding: 0 }} onClick={load}>Opdatér priser</button>
            <span className="muted small">Priser fra butikkernes hjemmesider lige nu. Tilbud og levering kan ændre totalen.</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="sheet" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Priser og køb online</h2>
          <button className="link" onClick={onClose}>Luk</button>
        </div>
        {body}
      </div>
    </div>
  );
}

/** Tjekliste til at lægge varerne i butikkens kurv: hver vare har et direkte link. */
function Checklist({ title, groups, missing, result, onBack }: {
  title: string; groups: { store: StoreId; picks: { need: Need; line: Line }[] }[]; missing: Need[]; result: PricesResponse; onBack: () => void;
}) {
  const [inBasket, setInBasket] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setInBasket((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const total = groups.reduce((s, g) => s + g.picks.reduce((t, p) => t + p.line.total, 0), 0);
  const single = groups.length === 1 ? groups[0].store : null;
  const [cartFor, setCartFor] = useState<{ store: StoreId; picks: { need: Need; line: Line }[] } | null>(null);

  // For varer, butikken ikke har: billigste alternativ i en anden butik.
  const alt = (n: Need) => {
    const lines = Object.values(result.items.find((i) => i.key === n.key)?.lines ?? {}).filter((l): l is Line => !!l);
    return lines.sort((a, b) => a.total - b.total)[0];
  };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button className="link" style={{ padding: 0 }} onClick={onBack}>‹ Tilbage</button>
        <b>{kr(Math.round(total * 100) / 100)}</b>
      </div>
      <div className="small muted">
        {title}. Tryk på en vare for at åbne den hos butikken og læg den i kurven der. Sæt flueben, når den er lagt i.
      </div>
      {groups.map((g) => {
        const store = STORES.find((s) => s.id === g.store)!;
        return (
          <div key={g.store} className="stack" style={{ gap: 6 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <b>{store.name}</b>
              <a className="btn small ghost" href={store.home} target="_blank" rel="noreferrer">Åbn {store.name}</a>
            </div>
            {CART_STORES.includes(g.store) && (
              <button className="btn" onClick={() => setCartFor({ store: g.store, picks: g.picks })}>Læg alle i kurven hos {store.name}</button>
            )}
            <ul className="items">
              {g.picks.map(({ need, line }) => {
                const k = `${g.store}|${need.key}`;
                const on = inBasket.has(k);
                const p = line.product;
                return (
                  <li key={k} className={"item" + (on ? " done" : "")}>
                    <span className="box" role="checkbox" aria-checked={on} aria-label={`${need.name} er lagt i kurven`} tabIndex={0}
                      onClick={() => toggle(k)} onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(k); } }}>
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </span>
                    <a className="main" href={p.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
                      <div className="nm">{line.packs > 1 ? `${line.packs} × ` : ""}{p.name}</div>
                      <div className="from">
                        Til: {need.name}{need.qtyText ? ` (${need.qtyText})` : ""}
                        {p.organic ? " · Øko" : ""}
                        {p.normalPrice ? " · Tilbud" : ""}
                        {p.unitPrice && p.unitPriceLabel ? ` · ${p.unitPrice.toLocaleString("da-DK", { maximumFractionDigits: 2 })} ${p.unitPriceLabel}` : ""}
                      </div>
                    </a>
                    <span className="qty">{kr(line.total)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {cartFor && <CartHelp store={cartFor.store} picks={cartFor.picks} onClose={() => setCartFor(null)} />}
      {missing.length > 0 && (
        <div className="card">
          <b className="small">{single ? `Findes ikke hos ${storeName(single)}` : "Blev ikke fundet"}</b>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {missing.map((m) => {
              const a = single ? alt(m) : undefined;
              return (
                <li key={m.key}>{m.name}{a && (
                  <span className="muted"> · <a href={a.product.url} target="_blank" rel="noreferrer">{storeName(a.product.store)} {kr(a.total)}</a></span>
                )}</li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Butikker, hvor genvejen "Læg i kurv" kan fylde kurven. */
const CART_STORES: StoreId[] = ["nemlig"];
/** Delingslink til genvejen. Tom, indtil genvejen er delt fra iCloud. */
const CART_SHORTCUT_URL = "";

/** Koden, genvejen læser fra udklipsholderen: "MADPLAN:nemlig:701025x2,5027572x1". */
export function cartCode(store: StoreId, picks: { line: Line }[]): string {
  const merged = new Map<string, number>();
  for (const p of picks) merged.set(p.line.product.id, Math.min(20, (merged.get(p.line.product.id) ?? 0) + p.line.packs));
  return `MADPLAN:${store}:` + [...merged].map(([id, q]) => `${id}x${q}`).join(",");
}

function copyText(text: string): boolean {
  try { navigator.clipboard?.writeText(text); return true; } catch { /* prøv den gamle måde */ }
  try {
    const t = document.createElement("textarea");
    t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok;
  } catch { return false; }
}

/** Pop-up: kopiér varerne, åbn butikken i Safari, og kør genvejen fra Del-menuen. */
function CartHelp({ store, picks, onClose }: { store: StoreId; picks: { line: Line }[]; onClose: () => void }) {
  const info = STORES.find((s) => s.id === store)!;
  const code = cartCode(store, picks);
  const [copied, setCopied] = useState(false);
  return (
    <div className="sheet" style={{ zIndex: 30, alignItems: "center" }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel" style={{ borderRadius: 18, margin: 16, width: "calc(100% - 32px)" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Læg i kurven hos {info.name}</h2>
          <button className="link" onClick={onClose}>Luk</button>
        </div>
        <ol className="small" style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 8 }}>
          <li>Tryk på knappen nedenfor. {picks.length} varer kopieres, og {info.name} åbner i Safari. Log ind, hvis du ikke allerede er det.</li>
          <li>Tryk på <b>Del</b> nederst i Safari (firkanten med pilen op).</li>
          <li>Vælg genvejen <b>Læg i kurv</b>. Varerne lægges i kurven, og siden genindlæses.</li>
        </ol>
        <a className="btn" href={info.home} target="_blank" rel="noreferrer" style={{ textAlign: "center" }}
          onClick={() => setCopied(copyText(code))}>Kopiér varerne og åbn {info.name}</a>
        {copied && <p className="status" style={{ margin: 0 }}>Varerne er kopieret.</p>}
        <p className="muted small" style={{ margin: 0 }}>
          Åbner {info.name} i et lille vindue inde i appen, så tryk på kompasset eller "Åbn i Safari" først.
          {CART_SHORTCUT_URL ? <> Mangler du genvejen? <a href={CART_SHORTCUT_URL} target="_blank" rel="noreferrer">Hent den her</a>.</> : null}
        </p>
      </div>
    </div>
  );
}

const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function PrefsEditor({ prefs, isParent, familyId, onDone }: { prefs: ShopPrefs; isParent: boolean; familyId: string; onDone: (changed: boolean) => void }) {
  const [p, setP] = useState(prefs);
  const [fav, setFav] = useState(prefs.favoriteBrands.join(", "));
  const [blocked, setBlocked] = useState(prefs.blockedBrands.join(", "));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    setBusy(true); setErr("");
    const next: ShopPrefs = { ...p, favoriteBrands: splitList(fav), blockedBrands: splitList(blocked) };
    const { error } = await supabase.from("families").update({ shop_prefs: next }).eq("id", familyId);
    setBusy(false);
    if (error) setErr(/shop_prefs/.test(error.message) ? "Databasen mangler opdateringen 011_priser.sql." : errorText(error));
    else onDone(true);
  }

  const toggleStore = (id: StoreId) => setP((x) => ({ ...x, stores: x.stores.includes(id) ? x.stores.filter((s) => s !== id) : [...x.stores, id] }));

  return (
    <div className="stack">
      <button className="link" style={{ padding: 0, justifySelf: "start" }} onClick={() => onDone(false)}>‹ Tilbage</button>
      {!isParent && <p className="muted small" style={{ margin: 0 }}>Det er mor eller far, der vælger præferencerne.</p>}
      <fieldset disabled={!isParent || busy} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 14 }}>
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">Økologi</b>
          <div className="segmented">
            {([["ignore", "Billigst"], ["prefer", "Øko når muligt"], ["require", "Kun øko"]] as const).map(([v, l]) => (
              <button key={v} type="button" aria-pressed={p.organic === v} onClick={() => setP({ ...p, organic: v })}>{l}</button>
            ))}
          </div>
        </div>
        <label className="stack" style={{ gap: 6 }}>
          <b className="small">Foretrukne mærker</b>
          <input value={fav} onChange={(e) => setFav(e.target.value)} placeholder="fx Arla, Lurpak" />
          <span className="muted small">Vælges, når butikken har dem, også hvis de er lidt dyrere.</span>
        </label>
        <label className="stack" style={{ gap: 6 }}>
          <b className="small">Mærker vi undgår</b>
          <input value={blocked} onChange={(e) => setBlocked(e.target.value)} placeholder="fx et mærke I ikke kan lide" />
        </label>
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">Butikker</b>
          {STORES.map((s) => (
            <label key={s.id} className="toggle">
              <input type="checkbox" checked={p.stores.includes(s.id)} onChange={() => toggleStore(s.id)} />
              {s.name} <span className="muted small">{s.note}</span>
            </label>
          ))}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={p.includeBasics} onChange={(e) => setP({ ...p, includeBasics: e.target.checked })} />
          Tag basisvarer med (salt, peber, olie …)
        </label>
      </fieldset>
      {err && <p className="status err">{err}</p>}
      {isParent && <div className="row end"><button className="btn" disabled={busy || !p.stores.length} onClick={save}>{busy ? "Gemmer …" : "Gem"}</button></div>}
    </div>
  );
}
