import type { VercelRequest, VercelResponse } from "@vercel/node";

/** Midlertidigt testpunkt: afprøver butikkernes varesøgning fra serveren. Kræver ?secret=PUSH_SECRET. */
export const config = { maxDuration: 60 };

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

async function get(url: string, init: RequestInit = {}): Promise<{ status: number; text: string; json?: any }> {
  try {
    const r = await fetch(url, { ...init, headers: { "user-agent": UA, accept: "application/json, text/html;q=0.9, */*;q=0.8", ...(init.headers || {}) } });
    const text = await r.text();
    let json: any; try { json = JSON.parse(text); } catch { /* ikke JSON */ }
    return { status: r.status, text: text.slice(0, 400000), json };
  } catch (e) { return { status: 0, text: String(e) }; }
}

const shape = (o: any, depth = 0): any => {
  if (depth > 3 || o == null) return o;
  if (Array.isArray(o)) return o.length ? [shape(o[0], depth + 1), `(${o.length} stk)`] : [];
  if (typeof o === "object") return Object.fromEntries(Object.entries(o).slice(0, 60).map(([k, v]) => [k, shape(v, depth + 1)]));
  return typeof o === "string" ? o.slice(0, 120) : o;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!process.env.PUSH_SECRET || req.query.secret !== process.env.PUSH_SECRET) return res.status(401).json({ error: "nej" });
  const q = String(req.query.q || "letmælk");
  const which = String(req.query.store || "all");
  const out: Record<string, unknown> = {};

  if (which === "all" || which === "nemlig") {
    const tok = await get("https://www.nemlig.com/webapi/Token", { headers: { "user-agent": "familiens-madplan/1.0" } });
    const basket = await get("https://www.nemlig.com/webapi/basket/GetBasket", { headers: { "user-agent": "familiens-madplan/1.0" } });
    const zone = basket.json?.DeliveryZoneId ?? 1, slot = basket.json?.TimeslotUtc ?? "";
    const s = await get(`https://webapi.prod.knl.nemlig.it/searchgateway/api/search?query=${encodeURIComponent(q)}&take=5&skip=0&timeslotUtc=${encodeURIComponent(slot)}&deliveryZoneId=${zone}`,
      { headers: { authorization: `Bearer ${tok.json?.access_token}`, "user-agent": "familiens-madplan/1.0" } });
    out.nemlig = { token: tok.status, basket: basket.status, zone, slot, search: s.status, body: shape(s.json) ?? s.text.slice(0, 500) };
  }
  if (which === "all" || which === "rema") {
    const s = await get(`https://api.digital.rema1000.dk/api/search/products?query=${encodeURIComponent(q)}&per_page=3&page=1`);
    out.rema = { status: s.status, body: shape(s.json) ?? s.text.slice(0, 500) };
  }
  if (which === "all" || which === "lidl") {
    const s = await get(`https://www.lidl.dk/q/api/search?q=${encodeURIComponent(q)}&assortment=DK&locale=da_DK&version=v2.0.0`);
    out.lidl = { status: s.status, body: shape(s.json) ?? s.text.slice(0, 500) };
  }
  if (which === "bilka-key") {
    const home = await get("https://www.bilkatogo.dk/");
    const scripts = [...home.text.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => new URL(m[1], "https://www.bilkatogo.dk/").toString());
    const hits: string[] = [];
    for (const s of scripts.slice(0, 25)) {
      const js = await get(s);
      for (const m of js.text.matchAll(/.{0,160}F9VBJLR1BK.{0,220}/g)) hits.push(`${s.split("/").pop()}: ${m[0]}`);
      for (const m of js.text.matchAll(/.{0,80}(algolia|apiKey|searchKey).{0,120}/gi)) if (hits.length < 40) hits.push(`${s.split("/").pop()}: ${m[0]}`);
    }
    const vals: string[] = [];
    for (const s of scripts.slice(0, 25)) {
      const js = await get(s);
      for (const m of js.text.matchAll(/(NUXT_ENV_ALGOLIA_[A-Z_]+|apiKey|searchKey)\s*[:=]\s*"([^"]{8,80})"/g)) vals.push(`${m[1]}=${m[2]}`);
    }
    const tests: string[] = [];
    for (const v of [...new Set(vals)]) {
      const key = v.split("=")[1];
      if (!/^[0-9a-f]{32}$/i.test(key)) continue;
      const t = await get("https://F9VBJLR1BK-dsn.algolia.net/1/indexes/prod_BILKATOGO_PRODUCTS/query", { method: "POST", headers: { "x-algolia-application-id": "F9VBJLR1BK", "x-algolia-api-key": key, "content-type": "application/json" }, body: JSON.stringify({ params: "query=m%C3%A6lk&hitsPerPage=1" }) });
      tests.push(`${key}: ${t.status} hits=${t.json?.nbHits}`);
    }
    out.bilka = { home: home.status, scripts: scripts.length, values: [...new Set(vals)], tests, hitCount: hits.length };
  }
  if (which === "algolia") {
    const key = String(req.query.key || ""), index = String(req.query.index || "prod_BILKATOGO_PRODUCTS");
    const s = await get(`https://F9VBJLR1BK-dsn.algolia.net/1/indexes/${index}/query`, {
      method: "POST",
      headers: { "x-algolia-application-id": "F9VBJLR1BK", "x-algolia-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ params: `query=${encodeURIComponent(q)}&hitsPerPage=3` }),
    });
    out.algolia = { status: s.status, body: shape(s.json) ?? s.text.slice(0, 500) };
  }
  if (which === "wolt-venues") {
    const lat = Number(req.query.lat || 55.6625), lon = Number(req.query.lon || 12.5139);
    const s = await get("https://restaurant-api.wolt.com/v1/pages/search", {
      method: "POST",
      headers: { "content-type": "application/json", platform: "Web", "app-language": "da" },
      body: JSON.stringify({ q, target: null, lat, lon }),
    });
    const slugs: string[] = [];
    JSON.stringify(s.json ?? {}).replace(/"slug":"([^"]+)"/g, (_m, g) => { slugs.push(g); return ""; });
    out.wolt = { status: s.status, slugs: [...new Set(slugs)].slice(0, 30), raw: s.json ? undefined : s.text.slice(0, 500) };
  }
  if (which === "wolt-items") {
    const slug = String(req.query.slug || "");
    const base = `https://consumer-api.wolt.com/consumer-api/consumer-assortment/v1/venues/slug/${slug}/assortment`;
    const enc = encodeURIComponent(q);
    const tries: [string, string, string?][] = [
      ["A", `${base}/items/search?language=da`, JSON.stringify({ q })],
      ["B", `${base}/search?language=da`, JSON.stringify({ q })],
      ["C", `${base}/items/search?language=da&q=${enc}`],
      ["D", `${base}/items?language=da&q=${enc}`],
      ["E", `https://consumer-api.wolt.com/consumer-api/consumer-assortment/v1/venues/slug/${slug}/search?language=da&q=${enc}`],
      ["F", `https://restaurant-api.wolt.com/v1/pages/venue/${slug}/search?q=${enc}`],
    ];
    out.wolt = [];
    for (const [tag, t, body] of tries) {
      const s = await get(t, { method: body ? "POST" : "GET", body, headers: { platform: "Web", "app-language": "da", "content-type": "application/json" } });
      (out.wolt as unknown[]).push({ tag, status: s.status, body: shape(s.json) ?? s.text.slice(0, 200) });
    }
  }
  if (req.query.format === "lines") {
    // Flad visning: én linje pr. felt, så felternes navne kan aflæses.
    const lines: string[] = [];
    const walk = (o: any, path: string) => {
      if (lines.length > 400) return;
      if (o && typeof o === "object") { for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k); }
      else lines.push(`${path} = ${String(o).slice(0, 100)}`);
    };
    walk(out, "");
    res.setHeader("content-type", "text/plain; charset=utf-8");
    return res.status(200).send(lines.join("\n"));
  }
  res.status(200).json(out);
}
