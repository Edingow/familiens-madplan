import type { VercelRequest, VercelResponse } from "@vercel/node";

/** Den offentlige nøgle, telefonen skal bruge for at tilmelde sig notifikationer. */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(503).json({ error: "Notifikationer er ikke sat op endnu." });
  res.setHeader("cache-control", "public, max-age=3600");
  res.status(200).json({ key });
}
