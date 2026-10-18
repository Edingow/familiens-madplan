import { fetchJson, isOrganic, parseSize, type StoreProduct } from "./types.js";

// nemlig.com bruger en anonym adgangsnøgle til søgning. Browser-UA giver afvisning, så vi præsenterer os ærligt.
const NUA = "familiens-madplan/1.0";
let session: Promise<{ token: string; zone: number; slot: string }> | null = null;

async function getSession() {
  const tok = await fetchJson("https://www.nemlig.com/webapi/Token", { headers: { "user-agent": NUA } });
  let zone = 1, slot = "";
  try {
    const b = await fetchJson("https://www.nemlig.com/webapi/basket/GetBasket", { headers: { "user-agent": NUA } });
    zone = b?.DeliveryZoneId ?? 1; slot = b?.TimeslotUtc ?? "";
  } catch { /* standardzone */ }
  if (!tok?.access_token) throw new Error("nemlig.com gav ingen adgang");
  return { token: tok.access_token as string, zone, slot };
}

const labelText = (l: any) => (typeof l === "string" ? l : l?.Name ?? l?.Label ?? "");

export async function searchNemlig(query: string): Promise<StoreProduct[]> {
  session ??= getSession().catch((e) => { session = null; throw e; });
  const s = await session;
  const url = `https://webapi.prod.knl.nemlig.it/searchgateway/api/search?query=${encodeURIComponent(query)}&take=12&skip=0&timeslotUtc=${encodeURIComponent(s.slot)}&deliveryZoneId=${s.zone}`;
  const j = await fetchJson(url, { headers: { authorization: `Bearer ${s.token}`, "user-agent": NUA } });
  const list: any[] = j?.Products?.Products ?? [];
  return list
    .filter((p) => p?.Availability?.IsAvailableInStock !== false && Number(p?.Price) > 0)
    .map((p): StoreProduct => {
      const desc = String(p.Description ?? "");
      const labels = (Array.isArray(p.Labels) ? p.Labels : []).map(labelText).join(" ");
      return {
        store: "nemlig",
        id: String(p.Id),
        name: String(p.Name ?? ""),
        brand: p.Brand || desc.split("/")[1]?.trim() || null,
        price: Number(p.Price),
        normalPrice: null,
        size: parseSize(desc.split("/")[0]),
        unitPrice: Number(p.UnitPriceCalc) || null,
        unitPriceLabel: p.UnitPriceLabel || null,
        organic: isOrganic(p.Name, desc, labels),
        url: p.Url ? `https://www.nemlig.com/${String(p.Url).replace(/^\//, "")}` : `https://www.nemlig.com/?search=${encodeURIComponent(query)}`,
        image: p.PrimaryImage || null,
      };
    });
}
