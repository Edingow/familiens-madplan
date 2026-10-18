# Familiens Madplan

Madplan, afstemning og fælles indkøbsliste for hele familien. Kører som app på hjemmeskærmen på iPhone.

**Det kan appen (fase 1)**
- Konti for alle i familien. Forældre har fuld adgang. Børn kan foreslå retter, stemme og krydse af på listen.
- Familiens kogebog under **Opskrifter**: gem opskrifter fra et link, indsat tekst eller et foto af en kogebog, og læg dem på madplanen eller til afstemning igen og igen.
- Idéer uden opskrift kan lægges direkte på madplanen eller til afstemning.
- Børnenes nye opskrifter og idéer bliver forslag under Opskrifter, som forældre kan lægge på madplanen.
- Afstemning om ugens madplan: alle kan markere retter som "ikke for mig" med en kort kommentar.
- Madplan for de næste 7 dage.
- Samlet indkøbsliste, hvor samme vare kun står én gang, sorteret i jeres butiks rækkefølge.
- Stregkodescanner med opslag i Open Food Facts. Foto af emballagen, når stregkoden ikke findes.
- Flueben virker uden net i butikken og sendes, når der er forbindelse igen.
- Live opdatering mellem telefonerne.
- Notifikationer på telefonen om nye varer, afstemninger og stemmer. Hver person vælger selv under **Familie**.

Online indkøb og prissammenligning er fase 2.

---

## Opsætning (cirka en time første gang)

Du skal bruge: din Mac, en browser og et betalingskort til Claude-API'et (et par kroner om måneden).

### 1. Installer Node.js på Mac'en
Hent "LTS"-versionen fra https://nodejs.org og installer den. Åbn derefter **Terminal** og gå ind i projektmappen:

```bash
cd ~/Downloads/familiens-madplan   # eller hvor du har pakket mappen ud
npm install
```

### 2. Opret databasen i Supabase
1. Opret en gratis konto på https://supabase.com og tryk **New project**. Vælg region **Frankfurt (eu-central-1)**.
2. Gå til **SQL Editor** → **New query**, indsæt hele indholdet af `supabase/schema.sql` og tryk **Run**. Har du en ældre database, så kør i stedet de nummererede filer (`002_…` til `007_…`), du ikke har kørt endnu.
3. Gå til **Authentication** → **Sign In / Providers** → **Email**. Slå **Confirm email** fra, hvis I vil kunne logge ind med det samme uden bekræftelsesmail.
4. Gå til **Project Settings** → **API** og kopiér **Project URL** og **anon public key**. Dem skal du bruge i trin 4.

### 3. Hent en nøgle til Claude
1. Opret en konto på https://console.anthropic.com.
2. Under **Billing** tilføjer du kredit, fx 5 dollars. Det rækker til tusindvis af opskrifter.
3. Under **API Keys** trykker du **Create Key** og kopierer nøglen.

### 4. Læg appen online med Vercel
1. Opret en gratis konto på https://vercel.com.
2. I Terminal:

```bash
npx vercel login
npx vercel link            # svar ja og vælg standardvalgene
npx vercel env add VITE_SUPABASE_URL production
npx vercel env add VITE_SUPABASE_ANON_KEY production
npx vercel env add ANTHROPIC_API_KEY production
npx vercel --prod
```

Hver `env add` beder dig indsætte værdien fra trin 2 og 3. Den sidste kommando udskriver appens adresse, fx `https://familiens-madplan.vercel.app`.

3. Gå tilbage til Supabase → **Authentication** → **URL Configuration** og sæt **Site URL** til appens adresse.

### 5. Installer appen på iPhone
1. Åbn appens adresse i **Safari**.
2. Tryk **Del** → **Føj til hjemmeskærm**.
3. Åbn appen fra hjemmeskærmen, opret en konto og vælg **Opret familie**.
4. Under **Indstillinger** står to koder. Mia bruger forældrekoden. Børnene bruger børnekoden. Alle skal have deres egen e-mail.
5. Sæt afdelingerne i den rækkefølge, I går gennem jeres faste supermarked.

### 6. Gem opskrifter direkte fra Safari, Instagram og TikTok (valgfrit)
1. I appen: **Familie** → **Vis min genvejsadresse** → **Kopiér adressen**.
2. Åbn **Genveje** → **+**. Kald genvejen **Gem opskrift**.
3. Tryk på **i** nederst, slå **Vis i delingsark** til, og vælg **URL'er** og **Tekst**.
4. Tilføj handlingen **Hent indhold af URL**. Indsæt adressen, sæt **Metode** til **POST**, **Anmodningstekst** til **JSON**, og tilføj feltet `url` med værdien **Genvejsinput**.
5. Tilføj handlingen **Vis meddelelse** med **Indhold af URL**.

---

## Notifikationer
1. I Vercel tilføjes `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` og `PUSH_SECRET`. Nøglerne laves med `npx web-push generate-vapid-keys`, og `PUSH_SECRET` er en lang tilfældig tekst.
2. I Supabase køres `supabase/006_notifikationer.sql`, og derefter:
   `select private.set_push_config('https://DIN-APP.vercel.app/api/push', 'SAMME-PUSH_SECRET');`
3. På telefonen: åbn appen fra hjemmeskærmen, gå til **Familie** og tryk **Slå notifikationer til**.

## Når du vil ændre noget
- `npm run dev` starter appen lokalt. Serverfunktionerne kræver `npx vercel dev` i stedet.
- `npm test` kører testene af sammenlægning og opskriftslæsning.
- `npx vercel --prod` lægger en ny version online. Telefonerne henter den automatisk.

## Opbygning
- `src/` er selve appen (React + TypeScript).
- `api/recipe.ts` henter opskrifter fra links, tekst og fotos og lader Claude læse ingredienserne.
- `api/product.ts` slår stregkoder op i Open Food Facts og genkender varer på fotos.
- `supabase/schema.sql` er databasen med adgangsregler: hver familie kan kun se sine egne data, og børn kan ikke ændre madplanen.

## Driftsudgifter
- Supabase og Vercel: gratis på jeres forbrug.
- Claude API: få øre pr. opskrift eller scanning. Modellen kan skiftes med variablen `CLAUDE_MODEL`.
