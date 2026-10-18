/** Prissammenligning og onlinekøb: fælles typer og beregninger for app og server. */

export type StoreId = "nemlig" | "bilka" | "rema" | "meny" | "woltmarket";

export const STORES: { id: StoreId; name: string; home: string; note: string }[] = [
  { id: "nemlig", name: "nemlig.com", home: "https://www.nemlig.com/", note: "Levering" },
  { id: "bilka", name: "BilkaToGo", home: "https://www.bilkatogo.dk/", note: "Levering eller afhentning" },
  { id: "rema", name: "Rema 1000", home: "https://shop.rema1000.dk/", note: "Bestil og hent i butik" },
  { id: "meny", name: "Meny Valby", home: "https://wolt.com/da/dnk/copenhagen/venue/meny-valby-toften", note: "Via Wolt" },
  { id: "woltmarket", name: "Wolt Market", home: "https://wolt.com/da/dnk/copenhagen/venue/wolt-market-khb-bdehavnsgade", note: "Via Wolt" },
];
export const storeName = (id: StoreId) => STORES.find((s) => s.id === id)?.name ?? id;

export interface ShopPrefs {
  /** "ignore": ligegyldigt, "prefer": økologi hvis den findes, "require": kun økologi. */
  organic: "ignore" | "prefer" | "require";
  favoriteBrands: string[];
  blockedBrands: string[];
  stores: StoreId[];
  /** Tag basisvarer (salt, olie ...) med i kurven. */
  includeBasics: boolean;
}
export const DEFAULT_PREFS: ShopPrefs = {
  organic: "ignore", favoriteBrands: [], blockedBrands: [], stores: STORES.map((s) => s.id), includeBasics: false,
};
export function readPrefs(p: Partial<ShopPrefs> | null | undefined): ShopPrefs {
  const ok = new Set(STORES.map((s) => s.id));
  return {
    organic: p?.organic === "prefer" || p?.organic === "require" ? p.organic : "ignore",
    favoriteBrands: Array.isArray(p?.favoriteBrands) ? p!.favoriteBrands.filter(Boolean).slice(0, 30) : [],
    blockedBrands: Array.isArray(p?.blockedBrands) ? p!.blockedBrands.filter(Boolean).slice(0, 30) : [],
    stores: Array.isArray(p?.stores) ? p!.stores.filter((s) => ok.has(s)) : DEFAULT_PREFS.stores,
    includeBasics: !!p?.includeBasics,
  };
}

/** Én vare fundet i en butik. */
export interface StoreProduct {
  store: StoreId;
  id: string;
  name: string;
  brand: string | null;
  /** Pris for én pakning i kr. */
  price: number;
  normalPrice: number | null;
  size: { amount: number; unit: "g" | "ml" | "stk" } | null;
  unitPrice: number | null;
  unitPriceLabel: string | null;
  organic: boolean;
  url: string;
  image: string | null;
}

/** Det, der skal købes af én vare. */
export interface Need { key: string; name: string; qtyText: string; g: number; ml: number; stk: number }

export interface Line { product: StoreProduct; packs: number; total: number }

/** Svar fra /api/prices for én vare: det bedste valg i hver butik (null = ikke fundet). */
export interface ItemPrices { key: string; lines: Partial<Record<StoreId, Line | null>> }

export interface PricesResponse { items: ItemPrices[]; errors: Partial<Record<StoreId, string>> }

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface StoreBasket { store: StoreId; found: { need: Need; line: Line }[]; missing: Need[]; total: number; failed?: string }

/** Saml svarene til én kurv pr. butik. */
export function basketsByStore(needs: Need[], items: ItemPrices[], stores: StoreId[], errors: PricesResponse["errors"] = {}): StoreBasket[] {
  const byKey = new Map(items.map((i) => [i.key, i]));
  return stores.map((store) => {
    const found: StoreBasket["found"] = [], missing: Need[] = [];
    for (const need of needs) {
      const line = byKey.get(need.key)?.lines[store];
      if (line) found.push({ need, line }); else missing.push(need);
    }
    return { store, found, missing, total: r2(found.reduce((s, f) => s + f.line.total, 0)), failed: errors[store] };
  }).sort((a, b) => b.found.length - a.found.length || a.total - b.total);
}

export interface CheapestBasket { picks: { need: Need; line: Line }[]; missing: Need[]; total: number; byStore: { store: StoreId; count: number; total: number }[] }

/** Billigste kurv: hver vare købes, hvor den er billigst, på tværs af alle kæder. */
export function cheapestBasket(needs: Need[], items: ItemPrices[]): CheapestBasket {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const picks: CheapestBasket["picks"] = [], missing: Need[] = [];
  for (const need of needs) {
    const lines = Object.values(byKey.get(need.key)?.lines ?? {}).filter((l): l is Line => !!l);
    if (!lines.length) { missing.push(need); continue; }
    lines.sort((a, b) => a.total - b.total);
    picks.push({ need, line: lines[0] });
  }
  const m = new Map<StoreId, { count: number; total: number }>();
  for (const p of picks) {
    const e = m.get(p.line.product.store) ?? { count: 0, total: 0 };
    e.count++; e.total = r2(e.total + p.line.total);
    m.set(p.line.product.store, e);
  }
  return {
    picks, missing,
    total: r2(picks.reduce((s, p) => s + p.line.total, 0)),
    byStore: [...m.entries()].map(([store, v]) => ({ store, ...v })).sort((a, b) => b.total - a.total),
  };
}

export const kr = (n: number) => n.toLocaleString("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " kr";
