import { fetchJson, isOrganic, parseSize, slugify, type StoreProduct } from "./types.js";

// BilkaToGo's offentlige søgenøgle (kun søgning), samme som hjemmesidens søgefelt bruger.
const APP = "F9VBJLR1BK";
const KEY = "1deaf41c87e729779f7695c00f190cc9";
const ATTRS = ["id", "name", "brand", "price", "sales_price", "units", "unitsOfMeasure", "netcontent", "unitOfMeasurePrice",
  "unitOfMeasurePriceUnits", "images", "targetOrganic", "isInStock", "description"];

export async function searchBilka(query: string): Promise<StoreProduct[]> {
  const params = new URLSearchParams({
    query, hitsPerPage: "12", attributesToHighlight: "[]", attributesToSnippet: "[]", attributesToRetrieve: JSON.stringify(ATTRS),
  });
  const j = await fetchJson(`https://${APP}-dsn.algolia.net/1/indexes/prod_BILKATOGO_PRODUCTS/query`, {
    method: "POST",
    headers: { "x-algolia-application-id": APP, "x-algolia-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify({ params: params.toString() }),
  });
  const hits: any[] = j?.hits ?? [];
  return hits.filter((h) => h.isInStock !== 0 && Number(h.sales_price ?? h.price) > 0).map((h): StoreProduct => {
    const price = Number(h.sales_price || h.price) / 100;
    const normal = Number(h.price) / 100;
    const unit = String(h.unitOfMeasurePriceUnits ?? "").toLowerCase().replace(/\.$/, "");
    return {
      store: "bilka",
      id: String(h.id ?? h.objectID),
      name: String(h.name ?? ""),
      brand: h.brand || null,
      price,
      normalPrice: normal > price ? normal : null,
      size: parseSize(h.netcontent) ?? parseSize(`${h.units} ${h.unitsOfMeasure}`),
      unitPrice: Number(h.unitOfMeasurePrice) ? Number(h.unitOfMeasurePrice) / 100 : null,
      unitPriceLabel: unit ? `kr/${unit}` : null,
      organic: h.targetOrganic === 1 || isOrganic(h.name, h.description),
      url: `https://www.bilkatogo.dk/produkt/${slugify(String(h.name ?? "vare"))}/${h.id ?? h.objectID}/`,
      image: Array.isArray(h.images) ? h.images[0] ?? null : null,
    };
  });
}
