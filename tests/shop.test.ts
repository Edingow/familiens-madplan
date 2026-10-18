import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSize, slugify } from "../api/_lib/stores/types";
import { chooseProduct, packsFor } from "../api/_lib/stores/choose";
import { searchRema } from "../api/_lib/stores/rema";
import { searchBilka } from "../api/_lib/stores/bilka";
import { searchWolt } from "../api/_lib/stores/wolt";
import { searchTerm } from "../api/prices";
import { basketsByStore, cheapestBasket, DEFAULT_PREFS, readPrefs, type ItemPrices, type Need, type StoreProduct } from "../src/lib/shop";

const prod = (p: Partial<StoreProduct>): StoreProduct => ({
  store: "rema", id: "1", name: "Vare", brand: null, price: 10, normalPrice: null, size: null,
  unitPrice: null, unitPriceLabel: null, organic: false, url: "https://x", image: null, ...p,
});
const need = (p: Partial<Need>): Need => ({ key: "k", name: "vare", qtyText: "", g: 0, ml: 0, stk: 0, ...p });

afterEach(() => vi.unstubAllGlobals());

describe("pakninger", () => {
  it("læser størrelser i butikkernes skrivemåder", () => {
    expect(parseSize("1 LTR. / REMA 1000")).toEqual({ amount: 1000, unit: "ml" });
    expect(parseSize("200 GR.")).toEqual({ amount: 200, unit: "g" });
    expect(parseSize("ARLA LETMÆLK FRISK 1 LT")).toEqual({ amount: 1000, unit: "ml" });
    expect(parseSize("6 x 33 cl")).toEqual({ amount: 1980, unit: "ml" });
    expect(parseSize("0,5 kg")).toEqual({ amount: 500, unit: "g" });
    expect(parseSize("10 stk")).toEqual({ amount: 10, unit: "stk" });
    expect(parseSize("Hvidløg")).toBeNull();
  });
  it("køber nok pakninger til behovet", () => {
    expect(packsFor(need({ g: 1200 }), prod({ size: { amount: 500, unit: "g" } }))).toBe(3);
    expect(packsFor(need({ g: 510 }), prod({ size: { amount: 500, unit: "g" } }))).toBe(1); // lidt over er ok
    expect(packsFor(need({ ml: 0, stk: 2 }), prod({ size: { amount: 1000, unit: "ml" } }))).toBe(1);
  });
  it("laver pæne adresser", () => expect(slugify("Smør & Ost Økologisk")).toBe("smoer-ost-oekologisk"));
});

describe("valg af vare", () => {
  const cands = [
    prod({ id: "a", name: "Letmælk", price: 10.95, size: { amount: 1000, unit: "ml" } }),
    prod({ id: "b", name: "Øko letmælk", price: 13.5, organic: true, size: { amount: 1000, unit: "ml" } }),
    prod({ id: "c", name: "Arla letmælk", brand: "Arla", price: 14, size: { amount: 1000, unit: "ml" } }),
  ];
  it("vælger billigst for den mængde, der skal bruges", () => {
    const l = chooseProduct(need({ ml: 1500 }), cands, DEFAULT_PREFS)!;
    expect(l.product.id).toBe("a"); expect(l.packs).toBe(2); expect(l.total).toBe(21.9);
  });
  it("følger økologi og mærker", () => {
    expect(chooseProduct(need({ ml: 1000 }), cands, { ...DEFAULT_PREFS, organic: "prefer" })!.product.id).toBe("b");
    expect(chooseProduct(need({ ml: 1000 }), cands.filter((c) => !c.organic), { ...DEFAULT_PREFS, organic: "require" })).toBeNull();
    expect(chooseProduct(need({ ml: 1000 }), cands, { ...DEFAULT_PREFS, favoriteBrands: ["arla"] })!.product.id).toBe("c");
    expect(chooseProduct(need({ ml: 1000 }), cands, { ...DEFAULT_PREFS, blockedBrands: ["Letmælk"] })).toBeNull();
  });
  it("renser søgeord", () => {
    expect(searchTerm("Persille, frisk (hakket)")).toBe("persille");
    expect(searchTerm("Hakket oksekød")).toBe("hakket oksekød");
  });
  it("læser præferencer forsigtigt", () => {
    expect(readPrefs(null).stores.length).toBe(5);
    expect(readPrefs({ organic: "require", stores: ["rema", "nope" as never] })).toMatchObject({ organic: "require", stores: ["rema"] });
  });
});

describe("kurve", () => {
  const needs = [need({ key: "mælk", name: "Mælk" }), need({ key: "smør", name: "Smør" }), need({ key: "safran", name: "Safran" })];
  const line = (store: StoreProduct["store"], total: number) => ({ product: prod({ store, price: total }), packs: 1, total });
  const items: ItemPrices[] = [
    { key: "mælk", lines: { rema: line("rema", 10.95), nemlig: line("nemlig", 12) } },
    { key: "smør", lines: { rema: line("rema", 20), nemlig: line("nemlig", 17.5) } },
    { key: "safran", lines: { rema: null, nemlig: null } },
  ];
  it("regner hver butiks kurv med fundne og manglende varer", () => {
    const b = basketsByStore(needs, items, ["rema", "nemlig"]);
    expect(b.map((x) => [x.store, x.found.length, x.missing.length, x.total])).toEqual([["nemlig", 2, 1, 29.5], ["rema", 2, 1, 30.95]]);
  });
  it("finder den billigste kurv på tværs af kæder", () => {
    const c = cheapestBasket(needs, items);
    expect(c.total).toBe(28.45);
    expect(c.missing.map((m) => m.key)).toEqual(["safran"]);
    expect(c.byStore).toEqual([{ store: "nemlig", count: 1, total: 17.5 }, { store: "rema", count: 1, total: 10.95 }]);
  });
});

describe("butikkernes svar", () => {
  const stub = (json: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(json), { status: 200 })));
  it("Rema 1000", async () => {
    stub({ data: [{ id: 20494, name: "LETMÆLK 1,5% FEDT", underline: "1 LTR. / REMA 1000", labels: [{ name: "REMA1000" }],
      images: [{ medium: "https://img" }], prices: [{ price: 10.95, is_campaign: false, starting_at: "2026-01-01T00:00:00Z", ending_at: "2099-12-31T00:00:00Z", compare_unit: "ltr", compare_unit_price: 10.95 }] }] });
    const [p] = await searchRema("letmælk");
    expect(p).toMatchObject({ name: "Letmælk 1,5% fedt", brand: "REMA 1000", price: 10.95, size: { amount: 1000, unit: "ml" }, unitPriceLabel: "kr/l" });
  });
  it("BilkaToGo", async () => {
    stub({ hits: [{ id: 119961, name: "Smørbar", brand: "Salling", price: 1195, sales_price: 995, netcontent: "200 g", unitOfMeasurePrice: 4975,
      unitOfMeasurePriceUnits: "Kg.", images: ["https://img"], targetOrganic: 0, isInStock: 1 }] });
    const [p] = await searchBilka("smør");
    expect(p).toMatchObject({ price: 9.95, normalPrice: 11.95, size: { amount: 200, unit: "g" }, unitPrice: 49.75, unitPriceLabel: "kr/kg",
      url: "https://www.bilkatogo.dk/produkt/smoerbar/119961/" });
  });
  it("Wolt (Meny Valby)", async () => {
    stub({ items: [{ id: "1e64", name: "ARLA LETMÆLK FRISK 1 LT", price: 1595, unit_info: "1 l", unit_price: { price: 1595, base: 1, unit: "litre" }, images: [] }] });
    const [p] = await searchWolt("meny", "letmælk");
    expect(p).toMatchObject({ store: "meny", price: 15.95, size: { amount: 1000, unit: "ml" }, unitPrice: 15.95, unitPriceLabel: "kr/l" });
    expect(p.url).toContain("/venue/meny-valby-toften/arla-letmaelk-frisk-1-lt-itemid-1e64");
  });
});
