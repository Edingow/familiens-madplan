import { describe, expect, it, vi, afterEach } from "vitest";
import { buildShoppingList, parseLine, guessCategory } from "../src/lib/merge";
import { extractJsonLdRecipe, pageText } from "../api/_lib/html";
import { defaultDeadline } from "../src/lib/util";
import type { Dish, Extra } from "../src/lib/types";

const dish = (p: Partial<Dish>): Dish => ({
  id: "d", recipe_id: null, family_id: "f", title: "Ret", url: null, image: null, note: null, servings_base: null, servings: null,
  items: [], status: "planned", plan_date: null, vote_deadline: null, created_by: null, created_at: "", ...p,
});

describe("indkøbsliste", () => {
  it("lægger samme vare sammen på tværs af opskrifter og enheder og skalerer personer", () => {
    const list = buildShoppingList([
      dish({ title: "Lasagne", servings_base: 4, servings: 6, items: [
        { name: "løg", qty: 2, unit: "stk", category: "frugt" },
        { name: "hakket oksekød", qty: 500, unit: "g", category: "kod" },
        { name: "mælk", qty: 5, unit: "dl", category: "mejeri" },
      ] }),
      dish({ title: "Chili", items: [
        { name: "Løg", qty: 1, unit: "", category: "frugt" },
        { name: "hakket oksekød", qty: 0.4, unit: "kg", category: "kod" },
        { name: "salt", qty: 1, unit: "tsk", category: "krydderi", basic: true },
        { name: "mælk", qty: 2, unit: "spsk", category: "mejeri", off: true },
      ] }),
      dish({ title: "Afstemning", status: "voting", items: [{ name: "løg", qty: 10, unit: "stk", category: "frugt" }] }),
    ], [{ name: "Mælk", qty: 1, unit: "l", category: "mejeri" } as Extra]);

    const by = Object.fromEntries(list.map((i) => [i.key, i]));
    expect(by["løg"].qtyText).toBe("4 stk");
    expect(by["løg"].sources).toEqual(["Lasagne", "Chili"]);
    expect(by["hakket oksekød"].qtyText).toBe("1,15 kg");
    expect(by["mælk"].qtyText).toBe("1,75 l");
    expect(by["salt"].category).toBe("basic");
  });

  it("viser skeer pænt", () => {
    const l = buildShoppingList([dish({ items: [{ name: "olie", qty: 1, unit: "tsk", category: "krydderi" }, { name: "olie", qty: 2, unit: "tsk", category: "krydderi" }] })], []);
    expect(l[0].qtyText).toBe("1 spsk");
  });

  it("tolker en linje i tilføj-feltet", () => {
    expect(parseLine("2 l mælk")).toEqual({ name: "mælk", qty: 2, unit: "l" });
    expect(parseLine("½ kg gulerødder")).toEqual({ name: "gulerødder", qty: 0.5, unit: "kg" });
    expect(parseLine("toiletpapir")).toEqual({ name: "toiletpapir", qty: null, unit: "" });
    expect(guessCategory("flåede tomater")).toBe("kolonial");
    expect(guessCategory("rødløg")).toBe("frugt");
  });
});

describe("opskriftssider", () => {
  it("finder opskriften i schema.org-data, også inde i @graph", () => {
    const html = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},
      {"@type":["Recipe"],"name":"Chili con carne","recipeYield":["4 personer"],"image":{"url":"https://x.dk/c.jpg"},
      "recipeIngredient":["500 g hakket oksekød","2 &amp; et halvt løg","1 dåse flåede tomater"]}]}</script></head><body></body></html>`;
    const r = extractJsonLdRecipe(html)!;
    expect(r.title).toBe("Chili con carne");
    expect(r.servings).toBe(4);
    expect(r.image).toBe("https://x.dk/c.jpg");
    expect(r.ingredients).toEqual(["500 g hakket oksekød", "2 & et halvt løg", "1 dåse flåede tomater"]);
  });
  it("giver null uden opskrift og fjerner scripts fra teksten", () => {
    const html = `<script>alert(1)</script><nav>Menu</nav><p>200 g smør</p><p>2 æg</p>`;
    expect(extractJsonLdRecipe(html)).toBeNull();
    expect(pageText(html)).toBe("200 g smør\n2 æg");
  });
});

describe("afstemningsfrist", () => {
  it("er førstkommende søndag kl. 18", () => {
    const d = defaultDeadline(new Date(2026, 9, 18, 9, 0)); // søndag morgen
    expect([d.getDay(), d.getDate(), d.getHours()]).toEqual([0, 18, 18]);
    const e = defaultDeadline(new Date(2026, 9, 18, 19, 0)); // søndag aften: næste søndag
    expect(e.getDate()).toBe(25);
  });
});

describe("serverfunktion /api/recipe", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("henter siden, sender ingredienserne til Claude og returnerer en ren opskrift", async () => {
    process.env.SUPABASE_URL = "https://sb.test"; process.env.SUPABASE_ANON_KEY = "anon"; process.env.ANTHROPIC_API_KEY = "k";
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any, init?: any) => {
      const u = String(url); calls.push(u);
      if (u.startsWith("https://sb.test/auth")) return new Response(JSON.stringify({ id: "u1" }));
      if (u.startsWith("https://opskrift.dk")) return new Response(`<script type="application/ld+json">{"@type":"Recipe","name":"Pasta","recipeYield":"2","recipeIngredient":["200 g pasta"]}</script>`);
      if (u.startsWith("https://api.anthropic.com")) {
        const body = JSON.parse(init.body);
        expect(body.messages[0].content.at(-1).text).toContain("200 g pasta");
        return new Response(JSON.stringify({ content: [{ type: "tool_use", input: { found: true, title: "Pasta", servings: 2, items: [{ name: "Pasta", qty: 200, unit: "g", category: "kolonial", basic: false }] } }] }));
      }
      return new Response("nej", { status: 404 });
    }));
    const { default: handler } = await import("../api/recipe");
    let status = 0, out: any;
    const res: any = { status(s: number) { status = s; return res; }, json(j: unknown) { out = j; return res; } };
    await handler({ method: "POST", headers: { authorization: "Bearer t" }, body: { url: "https://opskrift.dk/pasta" } } as any, res);
    expect(status).toBe(200);
    expect(out).toEqual({ title: "Pasta", servings: 2, image: null, items: [{ name: "pasta", qty: 200, unit: "g", category: "kolonial", basic: false }] });
    expect(calls.length).toBe(3);
  });
  it("afviser uden login og ved interne adresser", async () => {
    const { default: handler } = await import("../api/recipe");
    let status = 0;
    const res: any = { status(s: number) { status = s; return res; }, json() { return res; } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await handler({ method: "POST", headers: {}, body: { url: "https://x.dk" } } as any, res);
    expect(status).toBe(401);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "u" }))));
    await handler({ method: "POST", headers: { authorization: "Bearer t" }, body: { url: "http://169.254.169.254/latest" } } as any, res);
    expect(status).toBe(400);
  });
});
