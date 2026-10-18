import type { VercelRequest, VercelResponse } from "@vercel/node";
import { claudeStructured, UserFacingError } from "./_lib/claude.js";
import { fail, requireUser } from "./_lib/http.js";
import { chooseProduct } from "./_lib/stores/choose.js";
import { searchNemlig } from "./_lib/stores/nemlig.js";
import { searchRema } from "./_lib/stores/rema.js";
import { searchBilka } from "./_lib/stores/bilka.js";
import { searchWolt } from "./_lib/stores/wolt.js";
import { readPrefs, STORES, type ItemPrices, type Need, type PricesResponse, type StoreId, type StoreProduct } from "../src/lib/shop.js";

export const config = { maxDuration: 60 };

const SEARCH: Record<StoreId, (q: string) => Promise<StoreProduct[]>> = {
  nemlig: searchNemlig,
  bilka: searchBilka,
  rema: searchRema,
  meny: (q) => searchWolt("meny", q),
  woltmarket: (q) => searchWolt("woltmarket", q),
};

/** Søgeord ud fra varens navn: uden parenteser, mængdeord og tilberedning. */
export function searchTerm(name: string): string {
  return name.toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .split(/[,;]| eller /)[0]
    .replace(/\b(frisk|friske|finthakket|hakket fint|i tern|i skiver|revet|presset|smeltet|blød|kogt|kogte|stor|store|lille|små|evt\.?)\b/g, " ")
    .replace(/\s+/g, " ").trim() || name;
}

const MATCH_SYSTEM = `Du hjælper en dansk familie med at finde de rigtige varer i online-supermarkeder til deres indkøbsliste.
For hver vare på listen får du kandidater fra flere butikker (kode, navn, pakning, pris).
- accept: koderne på de kandidater, der er den vare, familien skal bruge. Andre mærker og størrelser er fine.
  Afvis varer, der kun ligner i navnet (fx hvidløgsdressing for hvidløg, kyllingebouillon for kylling, chips med paprika for paprika),
  forkert form, når det betyder noget (fx tørret persille for frisk persille, hel kylling for kyllingebryst), og helt andre varer.
  Hakket oksekød 8-12 % og 4-7 % er begge fine for "hakket oksekød". Konserves er fine for "hakkede tomater".
- need_g / need_ml: groft skøn over den samlede mængde i gram eller ml, når behovet er angivet i stk, fed, bundt, dåse osv.
  (fx 2 løg ≈ 300 g, 3 fed hvidløg ≈ 15 g, 1 bundt persille ≈ 30 g, 1 dåse hakkede tomater ≈ 400 g). Ellers null.
Svar kun med værktøjet.`;

const MATCH_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          accept: { type: "array", items: { type: "string" } },
          need_g: { type: ["number", "null"] },
          need_ml: { type: ["number", "null"] },
        },
        required: ["key", "accept", "need_g", "need_ml"],
      },
    },
  },
  required: ["items"],
};

const sizeText = (p: StoreProduct) => (p.size ? `${p.size.amount}${p.size.unit === "stk" ? " stk" : " " + p.size.unit}` : "?");

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return fail(res, 405, "Brug POST");
  if (!(await requireUser(req, res))) return;
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const prefs = readPrefs(body.prefs);
  const stores = (Array.isArray(body.stores) ? body.stores : prefs.stores).filter((s: string): s is StoreId => s in SEARCH);
  const needs: Need[] = (Array.isArray(body.needs) ? body.needs : []).slice(0, 10)
    .filter((n: any) => n && typeof n.key === "string" && typeof n.name === "string")
    .map((n: any) => ({
      key: n.key.slice(0, 80), name: String(n.name).slice(0, 80), qtyText: String(n.qtyText || "").slice(0, 40),
      g: Number(n.g) || 0, ml: Number(n.ml) || 0, stk: Number(n.stk) || 0,
    }));
  if (!needs.length || !stores.length) return fail(res, 400, "Ingen varer eller butikker.");

  // 1) Søg alle varer i alle butikker samtidig.
  const errors: PricesResponse["errors"] = {};
  const found = new Map<string, StoreProduct[]>(); // `${key}|${store}` -> kandidater
  await Promise.all(needs.flatMap((n) => stores.map(async (s: StoreId) => {
    try {
      found.set(`${n.key}|${s}`, (await SEARCH[s](searchTerm(n.name))).slice(0, 8));
    } catch (e) {
      console.error("butik", s, n.name, e);
      errors[s] = `${STORES.find((x) => x.id === s)?.name} svarede ikke`;
    }
  })));

  // 2) Lad Claude sortere de forkerte varer fra.
  const codes = new Map<string, StoreProduct>();
  const blocks = needs.map((n, i) => {
    const rows: string[] = [];
    stores.forEach((s: StoreId, si: number) => (found.get(`${n.key}|${s}`) ?? []).forEach((p, pi) => {
      const code = `${i}.${si}.${pi}`;
      codes.set(code, p);
      rows.push(`  ${code} ${p.name}${p.brand ? ` (${p.brand})` : ""} · ${sizeText(p)} · ${p.price} kr`);
    }));
    return `Vare key=${JSON.stringify(n.key)}: "${n.name}"${n.qtyText ? `, behov ${n.qtyText}` : ""}\n${rows.join("\n") || "  (ingen kandidater)"}`;
  });
  if (!codes.size) return res.status(200).json({ items: needs.map((n) => ({ key: n.key, lines: {} })), errors } satisfies PricesResponse);

  let verdict: { items: { key: string; accept: string[]; need_g: number | null; need_ml: number | null }[] };
  try {
    verdict = await claudeStructured({ system: MATCH_SYSTEM, text: blocks.join("\n\n"), toolName: "match", schema: MATCH_SCHEMA, maxTokens: 3000 });
  } catch (e) {
    console.error(e);
    return fail(res, 502, e instanceof UserFacingError ? e.message : "Varerne kunne ikke matches lige nu.");
  }

  // 3) Vælg den bedste vare i hver butik ud fra præferencerne.
  const items: ItemPrices[] = needs.map((n) => {
    const v = verdict.items?.find((x) => x.key === n.key);
    const need: Need = { ...n };
    if (!need.g && !need.ml && v) { need.g = Number(v.need_g) || 0; need.ml = Number(v.need_ml) || 0; }
    const ok = new Set(v?.accept ?? []);
    const lines: ItemPrices["lines"] = {};
    for (const s of stores as StoreId[]) {
      const cands = [...codes.entries()].filter(([c, p]) => ok.has(c) && p.store === s && found.get(`${n.key}|${s}`)?.includes(p)).map(([, p]) => p);
      lines[s] = errors[s] && !cands.length ? undefined : chooseProduct(need, cands, prefs);
    }
    return { key: n.key, lines };
  });
  res.status(200).json({ items, errors } satisfies PricesResponse);
}
