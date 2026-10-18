import { fetchJson, isOrganic, parseSize, slugify, tidyName, type StoreId, type StoreProduct } from "./types.js";

/** Butikker på Wolt. Meny Valby (Toften) er referencebutik for Meny. */
export const WOLT_VENUES: Partial<Record<StoreId, string>> = {
  meny: "meny-valby-toften",
  woltmarket: "wolt-market-khb-bdehavnsgade",
};

const UNIT: Record<string, string> = { litre: "kr/l", kilogram: "kr/kg", piece: "kr/stk" };

export async function searchWolt(store: StoreId, query: string): Promise<StoreProduct[]> {
  const slug = WOLT_VENUES[store];
  if (!slug) return [];
  const j = await fetchJson(
    `https://consumer-api.wolt.com/consumer-api/consumer-assortment/v1/venues/slug/${slug}/assortment/items/search?language=da`,
    { method: "POST", body: JSON.stringify({ q: query }), headers: { "content-type": "application/json", platform: "Web", "app-language": "da" } },
  );
  const list: any[] = j?.items ?? [];
  return list
    .filter((p) => Number(p?.price) > 0 && !p.disabled_info)
    .slice(0, 12)
    .map((p): StoreProduct => {
      const up = p.unit_price;
      const unitPrice = up?.price && up?.base ? up.price / 100 / up.base : null;
      return {
        store,
        id: String(p.id),
        name: tidyName(String(p.name ?? "")),
        brand: null,
        price: Number(p.price) / 100,
        normalPrice: p.original_price ? Number(p.original_price) / 100 : null,
        size: parseSize(p.unit_info) ?? parseSize(p.name),
        unitPrice,
        unitPriceLabel: up?.unit ? UNIT[up.unit] ?? `kr/${up.unit}` : null,
        organic: isOrganic(p.name, p.description),
        url: `https://wolt.com/da/dnk/copenhagen/venue/${slug}/${slugify(String(p.name ?? "vare"))}-itemid-${p.id}`,
        image: p.images?.[0]?.url ?? null,
      };
    });
}
