import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Leverer det lille script, som iPhone-genvejen "Læg i kurv" kører på butikkens side i Safari.
 * Genvejen sender indholdet af udklipsholderen med som ?d=, fx "MADPLAN:nemlig:701025x2,5027572x1".
 * Scriptet bruger brugerens eget login i Safari. Intet login eller kort kommer forbi serveren.
 */

const CODE = /^MADPLAN:([a-z]+):((?:[0-9A-Za-z_-]{1,40}x\d{1,2},?){1,80})$/;

export function parseCartCode(raw: string): { store: string; items: { id: string; qty: number }[] } | null {
  const m = raw.trim().match(CODE);
  if (!m) return null;
  const items = m[2].split(",").filter(Boolean).map((p) => {
    const i = p.lastIndexOf("x");
    return { id: p.slice(0, i), qty: Math.min(20, Math.max(1, Number(p.slice(i + 1)) || 1)) };
  });
  return { store: m[1], items };
}

const done = (msg: string) => `completion(${JSON.stringify(msg)});`;

const NEMLIG = `
(async () => {
  // iPhone giver genvejen få sekunder. Vi svarer i tide og gør arbejdet færdigt på siden bagefter.
  let answered = false;
  const answer = (m) => { if (!answered) { answered = true; completion(m); } };
  try {
    if (!/(^|\\.)nemlig\\.com$/.test(location.hostname)) return answer("Åbn nemlig.com i Safari, og kør genvejen derfra.");
    const items = __ITEMS__;
    const early = setTimeout(() => answer("Lægger " + items.length + " varer i kurven hos nemlig.com. Siden genindlæses om et øjeblik, når de er lagt i."), 3500);
    const base = { accept: "application/json, text/plain, */*", "content-type": "application/json", "device-size": "mobile", platform: "web" };
    const get = async (u, h) => { const r = await fetch(u, { credentials: "include", headers: h }); if (!r.ok) throw new Error(u + " " + r.status); return r.json(); };
    const [x, t] = await Promise.all([get("/webapi/AntiForgery", base), get("/webapi/Token", base)]);
    const h = { ...base, "x-xsrf-token": x.Value, authorization: "Bearer " + t.access_token };
    const basket = await get("/webapi/basket/GetBasket", h);
    const have = {};
    for (const l of basket.Lines || []) have[String(l.Id)] = Number(l.Quantity) || 0;
    let ok = 0, next = 0; const failed = [];
    const worker = async () => {
      while (next < items.length) {
        const it = items[next++];
        const id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random());
        try {
          const r = await fetch("/webapi/basket/AddToBasket", {
            method: "POST", credentials: "include", headers: { ...h, "x-correlation-id": id },
            body: JSON.stringify({ ProductId: it.id, quantity: (have[it.id] || 0) + it.qty, AffectPartialQuantity: false, disableQuantityValidation: false }),
          });
          if (r.ok) ok++; else failed.push(it.id + " (" + r.status + ")");
        } catch (e) { failed.push(it.id); }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    clearTimeout(early);
    const who = basket.InvoiceAddress && basket.InvoiceAddress.FirstName ? "" : " Du ser ikke ud til at være logget ind, så log ind for at se kurven.";
    answer(ok + " af " + items.length + " varer er lagt i kurven hos nemlig.com." + (failed.length ? " Fejlede: " + failed.join(", ") + "." : "") + who);
    setTimeout(() => location.reload(), 400);
  } catch (e) {
    answer("Det gik galt hos nemlig.com: " + (e && e.message ? e.message : e));
  }
})();`;

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("content-type", "text/javascript; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  const cart = parseCartCode(String(req.query.d || ""));
  if (!cart) return res.status(200).send(done("Tryk først på \"Læg i kurv\" i Familiens Madplan, og kør så genvejen igen."));
  if (cart.store === "nemlig") return res.status(200).send(NEMLIG.replace("__ITEMS__", JSON.stringify(cart.items)));
  res.status(200).send(done("Den butik kan genvejen ikke fylde kurven hos endnu."));
}
