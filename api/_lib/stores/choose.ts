import type { Line, Need, ShopPrefs, StoreProduct } from "../../../src/lib/shop.js";

const brandOf = (p: StoreProduct) => `${p.brand ?? ""} ${p.name}`.toLowerCase();
const matchesAny = (p: StoreProduct, brands: string[]) => brands.some((b) => b.trim() && brandOf(p).includes(b.trim().toLowerCase()));

/** Hvor mange pakninger der skal til for at dække behovet. */
export function packsFor(need: Need, p: StoreProduct): number {
  if (!p.size) return 1;
  const want = p.size.unit === "g" ? need.g : p.size.unit === "ml" ? need.ml : need.stk;
  if (!want) return 1;
  return Math.max(1, Math.ceil(want / p.size.amount - 0.05));
}

/** Vælg den bedste vare blandt relevante kandidater ud fra familiens præferencer. */
export function chooseProduct(need: Need, candidates: StoreProduct[], prefs: ShopPrefs): Line | null {
  let pool = candidates.filter((p) => p.price > 0 && !matchesAny(p, prefs.blockedBrands));
  if (prefs.organic === "require") pool = pool.filter((p) => p.organic);
  if (!pool.length) return null;
  const fav = pool.filter((p) => matchesAny(p, prefs.favoriteBrands));
  if (fav.length) pool = fav;
  if (prefs.organic === "prefer" && pool.some((p) => p.organic)) pool = pool.filter((p) => p.organic);
  const lines = pool.map((p) => { const packs = packsFor(need, p); return { product: p, packs, total: Math.round(packs * p.price * 100) / 100 }; });
  // Billigst for den mængde, der skal bruges; ved samme pris vinder den laveste kilopris.
  lines.sort((a, b) => a.total - b.total || (a.product.unitPrice ?? Infinity) - (b.product.unitPrice ?? Infinity));
  return lines[0];
}
