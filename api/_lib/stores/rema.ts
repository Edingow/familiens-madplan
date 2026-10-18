import { fetchJson, isOrganic, parseSize, tidyName, type StoreProduct } from "./types.js";

const UNIT: Record<string, string> = { ltr: "kr/l", kg: "kr/kg", stk: "kr/stk" };

export async function searchRema(query: string): Promise<StoreProduct[]> {
  const j = await fetchJson(`https://api.digital.rema1000.dk/api/search/products?query=${encodeURIComponent(query)}&per_page=12&page=1`);
  const list: any[] = j?.data ?? [];
  return list.map((p): StoreProduct | null => {
    const now = Date.now();
    const prices: any[] = Array.isArray(p.prices) ? p.prices : [];
    const active = prices.filter((x) => (!x.starting_at || Date.parse(x.starting_at) <= now) && (!x.ending_at || Date.parse(x.ending_at) >= now));
    const cur = active.find((x) => x.is_campaign) ?? active[0] ?? prices[0];
    if (!cur || !(Number(cur.price) > 0)) return null;
    const normal = active.find((x) => !x.is_campaign);
    const underline = String(p.underline ?? "");
    const labels = (p.labels ?? []).map((l: any) => l?.name ?? "").join(" ");
    return {
      store: "rema",
      id: String(p.id),
      name: tidyName(String(p.name ?? "")),
      brand: underline.split("/")[1]?.trim() || null,
      price: Number(cur.price),
      normalPrice: cur.is_campaign && normal ? Number(normal.price) : null,
      size: parseSize(underline.split("/")[0]),
      unitPrice: Number(cur.compare_unit_price) || null,
      unitPriceLabel: UNIT[cur.compare_unit] ?? (cur.compare_unit ? `kr/${cur.compare_unit}` : null),
      organic: isOrganic(p.name, underline, labels),
      url: `https://shop.rema1000.dk/varer/${p.id}`,
      image: p.images?.[0]?.medium ?? null,
    };
  }).filter((x): x is StoreProduct => !!x);
}
