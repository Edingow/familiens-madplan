import { asCategory, type Category, type Dish, type Extra, type Ingredient } from "./types";

/** Vægt, rumfang og skeer lægges sammen på tværs af enheder. Andre enheder (stk, fed, dåse ...) for sig. */
const UNITS: Record<string, [family: "m" | "v" | "s", factor: number]> = {
  g: ["m", 1], gram: ["m", 1], kg: ["m", 1000],
  ml: ["v", 1], cl: ["v", 10], dl: ["v", 100], l: ["v", 1000], liter: ["v", 1000],
  tsk: ["s", 1], spsk: ["s", 3],
};
const UNIT_ALIASES: Record<string, string> = { ds: "dåse", "dåser": "dåse", pk: "pakke", pakker: "pakke", "": "stk" };

export interface ListItem {
  key: string;
  name: string;
  category: Category | "basic";
  qtyText: string;
  sources: string[];
  /** Samlet mængde: g for vægt, ml for rumfang, tsk for skeer, og styk m.m. under "c:<enhed>". */
  totals: Record<string, number>;
}

export const keyOf = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim();

interface Acc { key: string; name: string; category: Category | "basic"; totals: Record<string, number>; sources: Set<string> }

export function buildShoppingList(dishes: Dish[], extras: Extra[]): ListItem[] {
  const map = new Map<string, Acc>();

  const add = (it: Ingredient | Extra, factor: number, source: string, basic: boolean) => {
    const key = keyOf(it.name);
    if (!key) return;
    let e = map.get(key);
    const cat = asCategory(it.category);
    if (!e) {
      e = { key, name: it.name.trim(), category: basic ? "basic" : cat, totals: {}, sources: new Set() };
      map.set(key, e);
    }
    // En vare der er "basis" i én opskrift men en rigtig vare i en anden, skal købes.
    if (!basic && e.category === "basic") e.category = cat;
    e.sources.add(source);
    const q = Number(it.qty);
    if (it.qty == null || !isFinite(q) || q <= 0) return;
    const rawUnit = (it.unit || "").toLowerCase().replace(/\.$/, "").trim();
    const known = UNITS[rawUnit];
    if (known) {
      e.totals[known[0]] = (e.totals[known[0]] || 0) + q * known[1] * factor;
    } else {
      const u = "c:" + (UNIT_ALIASES[rawUnit] ?? rawUnit);
      e.totals[u] = (e.totals[u] || 0) + q * factor;
    }
  };

  for (const d of dishes) {
    if (d.status !== "planned") continue;
    const base = Number(d.servings_base) || 0;
    const serv = Number(d.servings) || 0;
    const factor = base > 0 && serv > 0 ? serv / base : 1;
    for (const it of d.items || []) if (!it.off) add(it, factor, d.title, !!it.basic);
  }
  for (const x of extras) add(x, 1, "Tilføjet", false);

  return [...map.values()].map((e) => ({
    key: e.key,
    name: e.name.charAt(0).toUpperCase() + e.name.slice(1),
    category: e.category,
    qtyText: formatTotals(e.totals),
    sources: [...e.sources],
    totals: e.totals,
  }));
}

export const fmt = (n: number) =>
  (Math.round(n * 100) / 100).toLocaleString("da-DK", { maximumFractionDigits: 2 });

export function formatTotals(t: Record<string, number>): string {
  const parts: string[] = [];
  if (t.m) parts.push(t.m >= 1000 ? `${fmt(t.m / 1000)} kg` : `${fmt(Math.round(t.m))} g`);
  if (t.v) parts.push(t.v >= 1000 ? `${fmt(t.v / 1000)} l` : t.v >= 100 ? `${fmt(t.v / 100)} dl` : `${fmt(t.v)} ml`);
  if (t.s) {
    const sp = t.s / 3;
    const roundHalf = Math.abs(sp * 2 - Math.round(sp * 2)) < 0.05;
    parts.push(t.s >= 3 && (roundHalf || t.s >= 12) ? `${fmt(Math.round(sp * 2) / 2)} spsk` : `${fmt(t.s)} tsk`);
  }
  for (const k of Object.keys(t)) if (k.startsWith("c:")) parts.push(`${fmt(t[k])} ${k.slice(2)}`);
  return parts.join(" + ");
}

/** Kort, stabilt id til flueben, så samme vare har samme flueben hos alle. */
export function checkKey(key: string): string {
  let h = 5381;
  for (const c of key) h = ((h << 5) + h + c.codePointAt(0)!) >>> 0;
  return "k" + h.toString(36);
}

/** Hurtig tolkning af én linje som "2 l mælk" til tilføj-feltet. */
const LINE = /^([\d.,½¼¾/ -]+)?\s*(kg|g|gram|ml|cl|dl|l|liter|tsk|spsk|stk|fed|dåse|dåser|ds|pakke|pk|bundt)?\.?\s+(.+)$/i;
export function parseLine(text: string): Omit<Ingredient, "category"> {
  const t = text.trim();
  const m = t.match(LINE);
  if (!m || (!m[1] && !m[2])) return { name: t.toLowerCase(), qty: null, unit: "" };
  let q: number | null = null;
  if (m[1]) {
    let s = m[1].replace(",", ".").replace("½", ".5").replace("¼", ".25").replace("¾", ".75").trim();
    if (s.includes("-")) s = s.split("-").pop()!;
    if (s.includes("/")) { const [a, b] = s.split("/"); q = Number(a) / Number(b); } else q = parseFloat(s);
    if (!isFinite(q)) q = null;
  }
  const u = (m[2] || "").toLowerCase();
  return { name: m[3].trim().toLowerCase(), qty: q, unit: ({ gram: "g", liter: "l", ds: "dåse", "dåser": "dåse", pk: "pakke" } as Record<string, string>)[u] ?? u };
}

const KEYWORDS: [Category, RegExp][] = [
  ["kolonial", /flåede|hakkede tomater|dåse|tomatpuré|kokosmælk|passata/],
  ["frugt", /løg|kartof|gulerod|tomat|agurk|salat|spinat|peberfrugt|chili|ingefær|citron|lime|æble|banan|bær|avocado|squash|aubergine|porre|selleri|broccoli|blomkål|kål|svamp|champignon|persille|koriander|basilikum|purløg|dild|mynte|majs|fennikel|rødbede/],
  ["kod", /kød|kylling|svin|okse|lam|bacon|pølse|skinke|laks|torsk|rejer|fisk|kalkun/],
  ["mejeri", /mælk|fløde|smør|ost|parmesan|mozzarella|yoghurt|skyr|creme fraiche|æg/],
  ["brod", /brød|bolle|tortilla|pita|baguette|wrap/],
  ["krydderi", /salt|peber|spidskommen|paprika|kanel|karry|oregano|timian|olie|eddike|soja|bouillon|sennep|ketchup|mayo|sauce|honning/],
  ["kolonial", /pasta|spaghetti|ris|nudler|mel|sukker|gær|bagepulver|bønner|linser|kikærter|havregryn|nødder|chokolade|kaffe|te\b/],
  ["frost", /frost|frossen|frosne|is\b/],
  ["drikke", /sodavand|juice|vand|øl|vin|saft/],
];
export function guessCategory(name: string): Category {
  const n = name.toLowerCase();
  return (KEYWORDS.find(([, re]) => re.test(n)) ?? ["andet"])[0];
}

/** Behovet for en vare i butikkens enheder: gram, milliliter og styk. Skeer omregnes groft til ml. */
export function needOf(item: ListItem): { key: string; name: string; g: number; ml: number; stk: number } {
  const t = item.totals;
  let stk = 0;
  for (const k of Object.keys(t)) if (k.startsWith("c:")) stk += t[k];
  return { key: item.key, name: item.name, g: t.m || 0, ml: (t.v || 0) + (t.s || 0) * 5, stk };
}
