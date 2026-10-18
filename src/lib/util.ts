/** Formindsk et foto, så det sendes hurtigt og billigt. */
export async function imageToDataUrl(file: Blob, maxSide = 1400): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

const DAYS = ["søn", "man", "tir", "ons", "tor", "fre", "lør"];
const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** De næste 7 dage fra i dag, så madplanen altid ser fremad. */
export function nextDays(n = 7): { iso: string; label: string; short: string }[] {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    const name = i === 0 ? "I dag" : i === 1 ? "I morgen" : DAYS[x.getDay()].replace(/^./, (c) => c.toUpperCase());
    out.push({ iso: isoDate(x), label: `${name} ${x.getDate()}. ${MONTHS[x.getMonth()]}`, short: `${DAYS[x.getDay()]} ${x.getDate()}/${x.getMonth() + 1}` });
  }
  return out;
}

export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const x = new Date(y, m - 1, d);
  return `${DAYS[x.getDay()].replace(/^./, (c) => c.toUpperCase())} ${d}. ${MONTHS[m - 1]}`;
}

/** Standardfrist for afstemning: førstkommende søndag kl. 18 (eller næste, hvis den er passeret). */
export function defaultDeadline(now = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0);
  const add = (7 - d.getDay()) % 7;
  d.setDate(d.getDate() + add);
  if (d <= now) d.setDate(d.getDate() + 7);
  return d;
}

export function deadlineText(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (d <= new Date()) return "Afstemningen er slut";
  return `Stem senest ${DAYS[d.getDay()]} ${d.getDate()}. ${MONTHS[d.getMonth()]} kl. ${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(2, "0")}`;
}

export const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
