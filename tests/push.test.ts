import { describe, expect, it, vi } from "vitest";

const sent: unknown[] = [];
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async (sub: { endpoint: string }, payload: string) => {
      if (sub.endpoint.includes("gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      sent.push([sub.endpoint, JSON.parse(payload)]);
    }),
  },
}));

describe("serverfunktion /api/push", () => {
  it("afviser forkert kode og sender til gyldige telefoner", async () => {
    process.env.PUSH_SECRET = "hemmelig"; process.env.VAPID_PUBLIC_KEY = "pub"; process.env.VAPID_PRIVATE_KEY = "priv";
    const { default: handler } = await import("../api/push");
    let status = 0, out: any;
    const res: any = { status(s: number) { status = s; return res; }, json(j: unknown) { out = j; return res; } };
    await handler({ method: "POST", headers: { "x-push-secret": "forkert" }, body: {} } as any, res);
    expect(status).toBe(401);
    await handler({ method: "POST", headers: { "x-push-secret": "hemmelig" }, body: {
      title: "Indkøbslisten", body: "Luka har tilføjet mælk", tag: "list",
      subscriptions: [{ endpoint: "https://push/jon", keys: { p256dh: "p", auth: "a" } }, { endpoint: "https://push/gone", keys: { p256dh: "p", auth: "a" } }],
    } } as any, res);
    expect(status).toBe(200);
    expect(out).toEqual({ sent: 1, gone: 1 });
    expect(sent).toEqual([["https://push/jon", { title: "Indkøbslisten", body: "Luka har tilføjet mælk", tag: "list" }]]);
  });
});

describe("serverfunktion /api/share", () => {
  it("gemmer linket via databasen, også når siden ikke kan læses", async () => {
    process.env.SUPABASE_URL = "https://sb.test"; process.env.SUPABASE_ANON_KEY = "anon";
    const rpc: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes("/rpc/save_shared_recipe")) { rpc.push(JSON.parse(init.body)); return new Response('"Luka"'); }
      return new Response("login påkrævet", { status: 403 });
    }));
    const { default: handler } = await import("../api/share");
    let status = 0, text = "";
    const res: any = { status(s: number) { status = s; return res; }, setHeader() { return res; }, send(t: string) { text = t; return res; } };
    await handler({ method: "POST", query: { key: "ab".repeat(18) }, headers: {}, body: { url: "Se denne! https://www.instagram.com/p/abc123/ #mad" } } as any, res);
    expect(status).toBe(200);
    expect(text).toContain("Linket er gemt i Opskrifter: instagram.com");
    expect(rpc[0]).toMatchObject({ key: "ab".repeat(18), url: "https://www.instagram.com/p/abc123/", items: [] });
    await handler({ method: "POST", query: { key: "" }, headers: {}, body: { url: "https://x.dk" } } as any, res);
    expect(status).toBe(401);
    vi.unstubAllGlobals();
  });
});

describe("serverfunktion /api/plan-review", () => {
  it("sender ugens retter til Claude og returnerer en kort vurdering", async () => {
    process.env.SUPABASE_URL = "https://sb.test"; process.env.SUPABASE_ANON_KEY = "anon"; process.env.ANTHROPIC_API_KEY = "k";
    let prompt = "";
    vi.stubGlobal("fetch", vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "u1" }));
      prompt = JSON.parse(init.body).messages[0].content.at(-1).text;
      return new Response(JSON.stringify({ content: [{ type: "tool_use", input: { rating: "middel", summary: "Fin uge med lidt meget rødt kød.", points: [{ kind: "minus", text: "Brug fuldkornspasta.", dish: 1, swaps: [{ from: "pasta", to: "fuldkornspasta", category: "kolonial" }, { from: "findes ikke", to: "x", category: "andet" }] }, { kind: "plus", text: "Masser af grønt." }, { kind: "x", text: "y" }, { kind: "plus", text: "z" }, { kind: "plus", text: "for mange" }] } }] }));
    }));
    const { default: handler } = await import("../api/plan-review");
    let status = 0, out: any;
    const res: any = { status(s: number) { status = s; return res; }, json(j: unknown) { out = j; return res; } };
    await handler({ method: "POST", headers: { authorization: "Bearer t" }, body: { dishes: [{ title: "Lasagne", day: "Tir 20. okt", kcal: 750, servings: 4, items: ["hakket oksekød", "pasta"] }] } } as any, res);
    expect(status).toBe(200);
    expect(prompt).toContain("Tir 20. okt: Lasagne (ca. 750 kcal pr. person)");
    expect(out.rating).toBe("middel");
    expect(out.points).toHaveLength(4);
    expect(out.points[2].kind).toBe("minus");
    expect(out.points[0]).toMatchObject({ dish: 1, swaps: [{ from: "pasta", to: "fuldkornspasta", category: "kolonial" }] });
    expect(out.points[1]).toMatchObject({ dish: null, swaps: [] });
    vi.unstubAllGlobals();
  });
});
