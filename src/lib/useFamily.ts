import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import type { Dish, Extra, Family, Member, Recipe, Vote } from "./types";

export interface FamilyData {
  family: Family | null;
  me: Member | null;
  members: Member[];
  dishes: Dish[];
  recipes: Recipe[];
  votes: Vote[];
  extras: Extra[];
  checks: Set<string>;
}

const EMPTY: FamilyData = { family: null, me: null, members: [], dishes: [], recipes: [], votes: [], extras: [], checks: new Set() };
const CACHE = "madplan-cache-v2";
const QUEUE = "madplan-checks-queue-v1";

type CheckOp = { key: string; on: boolean };

function loadCache(): FamilyData | null {
  try {
    const raw = localStorage.getItem(CACHE);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return { ...EMPTY, ...d, checks: new Set(d.checks || []) };
  } catch { return null; }
}
function saveCache(d: FamilyData) {
  try { localStorage.setItem(CACHE, JSON.stringify({ ...d, checks: [...d.checks] })); } catch { /* fuld eller blokeret */ }
}
function loadQueue(): CheckOp[] {
  try { return JSON.parse(localStorage.getItem(QUEUE) || "[]"); } catch { return []; }
}
function saveQueue(q: CheckOp[]) {
  try { localStorage.setItem(QUEUE, JSON.stringify(q)); } catch { /* ignorer */ }
}

/** Henter familiens data, holder den opdateret live, og husker den til brug uden net. */
export function useFamily(userId: string | null) {
  const [data, setData] = useState<FamilyData>(() => loadCache() ?? EMPTY);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(!navigator.onLine);
  const dataRef = useRef(data);
  dataRef.current = data;

  const update = useCallback((patch: Partial<FamilyData>) => {
    setData((d) => { const n = { ...d, ...patch }; saveCache(n); return n; });
  }, []);

  const loadMembership = useCallback(async () => {
    if (!userId) return null;
    const { data: me, error } = await supabase.from("members").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    if (!me) { update({ ...EMPTY }); return null; }
    const [{ data: family }, { data: members }] = await Promise.all([
      supabase.from("families").select("*").eq("id", me.family_id).single(),
      supabase.from("members").select("*").eq("family_id", me.family_id).order("created_at"),
    ]);
    update({ me: me as Member, family: family as Family, members: (members || []) as Member[] });
    return me as Member;
  }, [userId, update]);

  const loadDishes = useCallback(async () => {
    const { data: dishes } = await supabase.from("dishes").select("*").in("status", ["voting", "planned"]).order("created_at");
    if (dishes) update({ dishes: dishes as Dish[] });
  }, [update]);
  const loadRecipes = useCallback(async () => {
    const { data: recipes } = await supabase.from("recipes").select("*").order("created_at", { ascending: false });
    if (recipes) update({ recipes: recipes as Recipe[] });
  }, [update]);
  const loadVotes = useCallback(async () => {
    const { data: votes } = await supabase.from("votes").select("*");
    if (votes) update({ votes: votes as Vote[] });
  }, [update]);
  const loadExtras = useCallback(async () => {
    const { data: extras } = await supabase.from("extras").select("*").order("created_at");
    if (extras) update({ extras: extras as Extra[] });
  }, [update]);
  const loadChecks = useCallback(async () => {
    const { data: checks } = await supabase.from("checks").select("item_key");
    if (!checks) return;
    // Lokale flueben der endnu ikke er sendt, vinder over serverens svar.
    const s = new Set(checks.map((c: { item_key: string }) => c.item_key));
    for (const op of loadQueue()) op.on ? s.add(op.key) : s.delete(op.key);
    update({ checks: s });
  }, [update]);

  const reloadAll = useCallback(async () => {
    try {
      const me = await loadMembership();
      if (me) await Promise.all([loadDishes(), loadRecipes(), loadVotes(), loadExtras(), loadChecks()]);
    } catch { /* uden net: vis det gemte */ }
    finally { setLoading(false); }
  }, [loadMembership, loadDishes, loadRecipes, loadVotes, loadExtras, loadChecks]);

  const flushQueue = useCallback(async () => {
    const q = loadQueue();
    if (!q.length || !dataRef.current.family) return;
    const fid = dataRef.current.family.id;
    const rest: CheckOp[] = [];
    for (const op of q) {
      const { error } = op.on
        ? await supabase.from("checks").upsert({ family_id: fid, item_key: op.key, checked_by: userId })
        : await supabase.from("checks").delete().eq("family_id", fid).eq("item_key", op.key);
      if (error) rest.push(op);
    }
    saveQueue(rest);
  }, [userId]);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    reloadAll().then(flushQueue);
    const timers: Record<string, ReturnType<typeof setTimeout>> = {};
    const debounce = (k: string, fn: () => void) => { clearTimeout(timers[k]); timers[k] = setTimeout(fn, 150); };
    const ch = supabase
      .channel("family")
      .on("postgres_changes", { event: "*", schema: "public", table: "dishes" }, () => debounce("d", loadDishes))
      .on("postgres_changes", { event: "*", schema: "public", table: "recipes" }, () => debounce("r", loadRecipes))
      .on("postgres_changes", { event: "*", schema: "public", table: "votes" }, () => debounce("v", loadVotes))
      .on("postgres_changes", { event: "*", schema: "public", table: "extras" }, () => debounce("x", loadExtras))
      .on("postgres_changes", { event: "*", schema: "public", table: "checks" }, () => debounce("c", loadChecks))
      .on("postgres_changes", { event: "*", schema: "public", table: "members" }, () => debounce("m", loadMembership))
      .on("postgres_changes", { event: "*", schema: "public", table: "families" }, () => debounce("m", loadMembership))
      .subscribe();
    const online = () => { setOffline(false); flushQueue().then(reloadAll); };
    const offlineFn = () => setOffline(true);
    const visible = () => { if (document.visibilityState === "visible") reloadAll(); };
    window.addEventListener("online", online);
    window.addEventListener("offline", offlineFn);
    document.addEventListener("visibilitychange", visible);
    return () => {
      supabase.removeChannel(ch);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offlineFn);
      document.removeEventListener("visibilitychange", visible);
      Object.values(timers).forEach(clearTimeout);
    };
  }, [userId, reloadAll, flushQueue, loadDishes, loadRecipes, loadVotes, loadExtras, loadChecks, loadMembership]);

  /** Flueben virker også uden net og sendes, når der er forbindelse igen. */
  const setChecked = useCallback(async (key: string, on: boolean) => {
    const s = new Set(dataRef.current.checks);
    on ? s.add(key) : s.delete(key);
    update({ checks: s });
    const q = loadQueue().filter((o) => o.key !== key);
    q.push({ key, on });
    saveQueue(q);
    if (navigator.onLine) await flushQueue();
  }, [update, flushQueue]);

  return { data, loading, offline, reloadAll, setChecked, loadDishes, loadRecipes, loadExtras, loadVotes, loadMembership };
}

export function clearLocalData() {
  try { localStorage.removeItem(CACHE); localStorage.removeItem(QUEUE); } catch { /* ignorer */ }
}
