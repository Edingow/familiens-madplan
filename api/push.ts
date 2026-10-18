import type { VercelRequest, VercelResponse } from "@vercel/node";
import webpush from "web-push";
import { timingSafeEqual } from "node:crypto";

export const config = { maxDuration: 30 };

interface Sub { endpoint: string; keys: { p256dh: string; auth: string } }

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Kaldes kun af databasen, når der sker noget, familien skal have besked om. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Brug POST" });
  const secret = process.env.PUSH_SECRET;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!secret || !pub || !priv) return res.status(500).json({ error: "Notifikationer er ikke sat op" });
  if (!sameSecret(String(req.headers["x-push-secret"] || ""), secret)) return res.status(401).json({ error: "Forkert kode" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const subs: Sub[] = Array.isArray(body.subscriptions) ? body.subscriptions.slice(0, 50) : [];
  const payload = JSON.stringify({
    title: String(body.title || "Familiens Madplan").slice(0, 80),
    body: String(body.body || "").slice(0, 300),
    tag: String(body.tag || "madplan"),
  });

  webpush.setVapidDetails("mailto:noreply@familiens-madplan.app", pub, priv);
  const results = await Promise.allSettled(subs.map((s) => webpush.sendNotification(s, payload, { TTL: 60 * 60 * 12 })));
  const gone = results.filter((r) => r.status === "rejected" && [404, 410].includes((r.reason as { statusCode?: number })?.statusCode ?? 0)).length;
  res.status(200).json({ sent: results.filter((r) => r.status === "fulfilled").length, gone });
}
