import { it, expect } from "vitest";
import cartScript from "../api/cart-script";
it("kører mod en falsk nemlig", async () => {
  let body = ""; const res: any = { setHeader() {}, status() { return res; }, send(b: string) { body = b; } };
  cartScript({ query: { d: "MADPLAN:nemlig:701025x2,99x1" } } as any, res);
  const posts: any[] = [];
  const fetch = async (u: string, o: any = {}) => {
    const j = (x: any, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => x });
    if (u.includes("AntiForgery")) return j({ Value: "X" });
    if (u.includes("Token")) return j({ access_token: "T" });
    if (u.includes("GetBasket")) return j({ InvoiceAddress: { FirstName: "Jon" }, Lines: [{ Id: "701025", Quantity: 1 }] });
    posts.push({ h: o.headers, b: JSON.parse(o.body) }); return j({}, !String(o.body).includes('"99"'));
  };
  const msg = await new Promise<string>((done) => new Function("completion", "fetch", "location", "crypto", "setTimeout", body)(done, fetch, { hostname: "www.nemlig.com", reload() {} }, { randomUUID: () => "u" }, () => {}));
  console.log(msg, JSON.stringify(posts[0]));
  expect(posts[0].b).toMatchObject({ ProductId: "701025", quantity: 3 });
  expect(posts[0].h.authorization).toBe("Bearer T");
  expect(msg).toContain("1 af 2");
});
