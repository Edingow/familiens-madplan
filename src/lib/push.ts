import { supabase } from "./supabase";

export type PushKind = "list" | "vote" | "votes";
export type Prefs = Record<PushKind, boolean>;
export const DEFAULT_PREFS: Prefs = { list: true, vote: true, votes: true };

export type PushState =
  | { kind: "unsupported" }
  | { kind: "needs-home-screen" }
  | { kind: "denied" }
  | { kind: "off" }
  | { kind: "on"; endpoint: string; prefs: Prefs };

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

function keyToBytes(base64: string): Uint8Array {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function getPushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return { kind: "needs-home-screen" };
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return { kind: "unsupported" };
  if (Notification.permission === "denied") return { kind: "denied" };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return { kind: "off" };
  const { data } = await supabase.from("push_subscriptions").select("prefs").eq("endpoint", sub.endpoint).maybeSingle();
  if (!data) return { kind: "off" };
  return { kind: "on", endpoint: sub.endpoint, prefs: { ...DEFAULT_PREFS, ...(data.prefs as Partial<Prefs>) } };
}

/** Skal kaldes direkte fra et tryk på en knap, ellers afviser iPhone at spørge om lov. */
export async function enablePush(userId: string, familyId: string): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { kind: permission === "denied" ? "denied" : "off" };
  const r = await fetch("/api/push-key");
  const { key, error } = await r.json();
  if (!key) throw new Error(error || "Notifikationer er ikke sat op endnu.");
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(key) as BufferSource }));
  const json = sub.toJSON();
  const { error: dbError } = await supabase.from("push_subscriptions").upsert({
    endpoint: sub.endpoint, user_id: userId, family_id: familyId,
    p256dh: json.keys?.p256dh, auth: json.keys?.auth, prefs: DEFAULT_PREFS,
  });
  if (dbError) throw dbError;
  return { kind: "on", endpoint: sub.endpoint, prefs: DEFAULT_PREFS };
}

export async function disablePush(endpoint: string) {
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  const reg = await navigator.serviceWorker.getRegistration();
  await (await reg?.pushManager.getSubscription())?.unsubscribe();
}

export async function savePrefs(endpoint: string, prefs: Prefs) {
  const { error } = await supabase.from("push_subscriptions").update({ prefs }).eq("endpoint", endpoint);
  if (error) throw error;
}
