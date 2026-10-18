/** Fælles format for en vare fundet i en butik. */
export interface StoreProduct {
  store: StoreId;
  id: string;
  name: string;
  brand: string | null;
  /** Pris for én pakning i kr. */
  price: number;
  /** Normalpris, hvis varen er på tilbud. */
  normalPrice: number | null;
  /** Pakningens størrelse i basisenhed: gram, milliliter eller styk. */
  size: { amount: number; unit: "g" | "ml" | "stk" } | null;
  /** Kilopris/literpris i kr., hvis butikken oplyser den. */
  unitPrice: number | null;
  unitPriceLabel: string | null;
  organic: boolean;
  url: string;
  image: string | null;
}

export type StoreId = "nemlig" | "bilka" | "rema" | "netto" | "foetex" | "lidl" | "meny" | "woltmarket";

export interface StoreInfo {
  id: StoreId;
  name: string;
  /** Kan bestilles online (levering eller afhentning). */
  online: boolean;
  search: (query: string) => Promise<StoreProduct[]>;
}

const UNIT_RE = /(\d+(?:[.,]\d+)?)\s*(?:x\s*(\d+(?:[.,]\d+)?)\s*)?(kg|g|gr|l|ltr|liter|dl|cl|ml|stk|st)\b/i;

/** Læs pakningsstørrelse fra tekst som "500 g", "1 l", "6 x 33 cl" eller "10 stk". */
export function parseSize(text: string | null | undefined): StoreProduct["size"] {
  if (!text) return null;
  const m = String(text).replace(",", ".").match(UNIT_RE);
  if (!m) return null;
  let a = parseFloat(m[1]);
  if (m[2]) a = a * parseFloat(m[2]);
  const u = m[3].toLowerCase();
  if (!isFinite(a) || a <= 0) return null;
  if (u === "kg") return { amount: a * 1000, unit: "g" };
  if (u === "g" || u === "gr") return { amount: a, unit: "g" };
  if (u === "l" || u === "ltr" || u === "liter") return { amount: a * 1000, unit: "ml" };
  if (u === "dl") return { amount: a * 100, unit: "ml" };
  if (u === "cl") return { amount: a * 10, unit: "ml" };
  if (u === "ml") return { amount: a, unit: "ml" };
  return { amount: a, unit: "stk" };
}

export const isOrganic = (...texts: (string | null | undefined)[]) =>
  texts.some((t) => !!t && /økolog|øko\b|\bøko-|organic|ø-mærke/i.test(t));

export const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

export async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 10000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal, headers: { accept: "application/json", "user-agent": UA, ...(init.headers || {}) } });
    if (!r.ok) throw new Error(`${new URL(url).hostname} svarede ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}
