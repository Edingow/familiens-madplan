import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AddDish, type FillTarget } from "./components/AddDish";
import { IconBook, IconCalendar, IconCart, IconGear, IconVote } from "./components/Icons";
import { configured, supabase } from "./lib/supabase";
import type { Dish } from "./lib/types";
import { useFamily } from "./lib/useFamily";
import { Auth } from "./screens/Auth";
import { MealPlan } from "./screens/MealPlan";
import { Onboarding } from "./screens/Onboarding";
import { Recipes } from "./screens/Recipes";
import { Settings } from "./screens/Settings";
import { ShoppingList } from "./screens/ShoppingList";
import { Voting } from "./screens/Voting";

type Tab = "list" | "plan" | "recipes" | "vote" | "settings";
const TITLES: Record<Tab, string> = { list: "Indkøb", plan: "Madplan", recipes: "Opskrifter", vote: "Afstemning", settings: "Familie" };

/** Et link delt via iOS-genvejen åbner appen med ?url=... */
function takeSharedUrl(): string | undefined {
  const p = new URLSearchParams(location.search);
  const raw = p.get("url") || p.get("text") || "";
  const m = raw.match(/https?:\/\/\S+/);
  if (p.has("url") || p.has("text")) history.replaceState(null, "", location.pathname);
  return m?.[0];
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [sharedUrl, setSharedUrl] = useState<string | undefined>(() => takeSharedUrl());

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!configured) {
    return <div className="app"><div className="auth"><h1>Mangler opsætning</h1><p className="muted">VITE_SUPABASE_URL og VITE_SUPABASE_ANON_KEY er ikke sat. Se README.</p></div></div>;
  }
  if (!ready) return null;
  if (!session) return <Auth />;
  return <Main userId={session.user.id} sharedUrl={sharedUrl} clearShared={() => setSharedUrl(undefined)} />;
}

function Main({ userId, sharedUrl, clearShared }: { userId: string; sharedUrl?: string; clearShared: () => void }) {
  const fam = useFamily(userId);
  const { data } = fam;
  const [tab, setTab] = useState<Tab>(() => (sharedUrl ? "recipes" : "list"));
  const [adding, setAdding] = useState<boolean>(!!sharedUrl);
  const [fill, setFill] = useState<FillTarget | null>(null);

  if (fam.loading && !data.me) return null;
  if (!data.me || !data.family) return <Onboarding onDone={fam.reloadAll} />;

  const pendingVotes = data.dishes.filter((d) =>
    d.status === "voting" && (!d.vote_deadline || new Date(d.vote_deadline) > new Date()) &&
    !data.votes.some((v) => v.dish_id === d.id && v.user_id === userId)).length;

  const common = { data, userId, onChanged: fam.reloadAll, openAdd: () => setAdding(true), onFill: (d: Dish) => setFill({ kind: "dish", dish: d }) };

  const tabBtn = (t: Tab, icon: React.ReactNode, badge?: number) => (
    <button className="tab" aria-current={tab === t ? "page" : undefined} onClick={() => { setTab(t); window.scrollTo(0, 0); }}>
      {icon}{TITLES[t]}{badge ? <span className="badge">{badge}</span> : null}
    </button>
  );

  return (
    <>
      <div className="app">
        <header className="topbar">
          <h1>{TITLES[tab]}</h1>
          <span className="muted small">{data.family.name}</span>
        </header>
        {fam.offline && <div className="banner">Ingen forbindelse. Flueben gemmes og sendes, når du er online igen.</div>}

        {tab === "list" && <ShoppingList {...common} setChecked={fam.setChecked} />}
        {tab === "plan" && <MealPlan {...common} />}
        {tab === "recipes" && <Recipes data={data} userId={userId} onChanged={fam.reloadAll} openAdd={common.openAdd} onFill={(t) => setFill(t)} goTo={(t) => { setTab(t); window.scrollTo(0, 0); }} />}
        {tab === "vote" && <Voting {...common} />}
        {tab === "settings" && <Settings data={data} userId={userId} onChanged={fam.reloadAll} />}
      </div>

      {tab !== "settings" && <button className="fab" onClick={() => setAdding(true)}>+ Ny opskrift</button>}

      <nav className="tabs" aria-label="Hovedmenu">
        <div className="tabs-inner">
          {tabBtn("list", <IconCart />)}
          {tabBtn("plan", <IconCalendar />)}
          {tabBtn("recipes", <IconBook />)}
          {tabBtn("vote", <IconVote />, pendingVotes)}
          {tabBtn("settings", <IconGear />)}
        </div>
      </nav>

      {(adding || fill) && (
        <AddDish
          data={data}
          userId={userId}
          initialUrl={fill ? undefined : sharedUrl}
          fill={fill ?? undefined}
          onClose={() => { setAdding(false); setFill(null); clearShared(); }}
          onSaved={(where) => { setAdding(false); setFill(null); clearShared(); fam.reloadAll(); if (!fill) setTab(where === "voting" ? "vote" : where === "planned" ? "plan" : "recipes"); }}
        />
      )}
    </>
  );
}
