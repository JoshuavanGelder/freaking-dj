# Freaking DJ — werkafspraken voor Claude

Android-app (Expo SDK 57, React Native 0.86, React 19.2, TypeScript): persoonlijke "AI DJ" voor Spotify.
Eigenaar: Joshua van Gelder (Nederlands; antwoord in het Nederlands). Stijl: bijna Spotify (donker, groen
`#1ED760`, pill-knoppen, Figtree), eigen naam en icoon, geen Spotify-logo.

## Werkwijze met Joshua
- Joshua werkt vanaf zijn telefoon (Galaxy S25) + GitHub. Geen afhankelijkheid van een desktop.
- Hij installeert de APK uit GitHub Releases. Elke push naar `main` = nieuwe build + release `build-N`.
- Kort en concreet rapporteren; na een push eerst de snelle `checks`-job bekijken, de APK-build duurt ~10 min.

## Claude via zijn abonnement (géén API-key)
- De app zet een verzoek in branch `dj-data` (`requests/<id>.json`) en start `.github/workflows/dj.yml`
  (workflow_dispatch, run-name `DJ <id>`).
- Die workflow draait de **officiële, ongewijzigde Claude Code** (`npm i -g @anthropic-ai/claude-code`,
  `claude -p`) met secret `CLAUDE_CODE_OAUTH_TOKEN` (gemaakt met `claude setup-token`, 1 jaar geldig).
  Dat is de door Anthropic ondersteunde manier voor Pro/Max in GitHub Actions. Geen `--bare` (die leest geen OAuth).
- **Warme DJ**: bij het openen van de app start `dj.yml` met `request_id=standby` (run-name `DJ standby`):
  `dj/standby.mjs` blijft 10 min na het laatste verzoek klaarstaan en pakt nieuwe `requests/` meteen op
  (git fetch elke 1,5 s). Staat er geen warme DJ, dan start de app een losse run. Vangnet: na 75 s alsnog een losse run.
- Snelheid: `--effort low` (niet voor haiku), pool-nummers zonder titel/artiest in het antwoord, 5 reserves,
  nieuwe nummers parallel opzoeken, geschiedenis vooraf ophalen, app pollt elke 2 s.
- `dj/handle.mjs` (via `run.mjs` of `standby.mjs`) schrijft `responses/<id>.json` met `status` ok | limiet | token | fout (+ `resetAt`). De app
  toont limiet/token/storing; daarnaast `status.claude.com/api/v2/summary.json`.
- Claude krijgt `dj/prompt.md` als systeemprompt en `dj/schema.json` als `--json-schema`; alleen WebSearch.
  Werkmap is een lege tmp-map, zodat Claude dit bestand niet ziet.

## Harde regels (de app controleert ze zelf in `src/logic/rules.ts`)
Nooit een playlist/album starten (alleen losse nummers + wachtrij) · toevoegen = alleen achteraan, niets
dubbel · vervangen pas na het huidige nummer (tenzij skippen mag), oude wachtrij echt weg (Spotify kan de
wachtrij niet leegmaken → oude nummers overslaan met volume kort op 0, daarna terugzetten) · blocklist (Loreen)
· Eurovisie-favoriet "Viva, Moldova!" (Satoshi) altijd in een Eurovisie-wachtrij · worship alleen op verzoek ·
actief apparaat gebruiken, nooit zelf overzetten; niets actief → pc `joshua-mooore`, nooit de Denon.

## Bijsturen (`src/logic/adjust.ts`)
`adjustKind` herkent toevoegen ("doe er X bij", "voeg … toe", "nog 2 nummers …"), weghalen ("haal X weg",
"geen X") en breed ("rustiger", "meer NF"). Bij toevoegen/weghalen voegt de app Claudes antwoord zelf samen
(`mergeAdjusted`): de rest blijft gegarandeerd staan in dezelfde volgorde; bij toevoegen gaat `count` omhoog.
Plan krijgt `parentId`/`change`/`addedIds` → knop "Vorige versie" en toegevoegde nummers gemarkeerd.
In Live DJ komen toegevoegde nummers vooraan in `upcoming`.

## Live DJ (`src/logic/live.ts`, `src/live.tsx`, native `LiveQueuer.kt`)
Zet steeds maar één nummer vooruit in de Spotify-wachtrij en kiest het volgende pas als ons nummer begint.
- **De meeluister-dienst doet het klaarzetten** (`LiveQueuer`), zodat het ook met je scherm uit op tijd gebeurt:
  op de Spotify-broadcast "nummer gewisseld" (direct) én door zelf `GET /me/player` te doen vlak voor het eind
  van elk nummer (werkt ook als je op de pc of de Denon speelt). Partial wakelock zolang Live DJ loopt (max 4 u).
- Het Spotify-token is in native code (`SpotifyAuth`, SharedPreferences `fdj-auth`): één eigenaar van het
  roterende refresh-token. JS vraagt `W.accessToken()`; oude SecureStore-tokens worden eenmalig overgezet.
- JS geeft de dienst de kandidaten (al gecontroleerd op de regels) en neemt op elke tick over wat de dienst deed
  (`reconcileNative`: klaargezet nummer + geschiedenis). Vangnet: zet de dienst na 8 s niets klaar, dan doet JS het.
- Keuze na skips (JS `pickNext` en Kotlin `choose`, zelfde regels): geen zelfde artiest, geen nieuw na geskipt nieuw,
  na 2 skips in één stijl even een andere stijl. Houd die twee gelijk.
- Claude stuurt op de achtergrond bij (`makePlan` met `count: 15`) bij 2 snelle skips of < 5 over; handmatig via
  het Nu-scherm. Stopt vanzelf na 30 min niets spelen (JS én dienst).
- **Geen dubbelen na bijsturen** (`usedSet`/`isUsed` in `live.ts`): wat gespeeld is, nu speelt, klaarstaat of in de Spotify-wachtrij zit
  (ook een andere versie: `songKey`) komt nooit terug. Geldt in `applyReplan` (vlak voor het inpassen wordt eerst `reconcileNative`
  gedaan en `sp.queue()` opgehaald), `pickNext`, `candidates()` en bij `makePlan` met `excludeUsed` (dan echt geweigerd via
  `alreadyQueued`/`alreadyKeys`, niet alleen als tip aan Claude). De dienst filtert in `setCandidates` zelf ook op klaargezet/lastId/geschiedenis,
  omdat de app soms achterloopt. Reload-knop: `missingQueued` met `now` doet niets binnen `QUEUE_LAG_MS` (Spotify loopt na een skip achter)
  en kijkt eerst 2 s later nog eens voordat iets opnieuw wordt toegevoegd.
- **Reload-knop op het Nu-scherm** (`resync` in `live.tsx`, `missingQueued` in `live.ts`): controleert of `queuedId` nog in de
  Spotify-wachtrij staat (of al speelt) en zet het anders opnieuw klaar, ook bij de dienst (`liveSetQueued`). Voor als je de
  wachtrij leegmaakte terwijl Live DJ liep. Beperking: Spotify toont maar ±20 nummers van de wachtrij.
- **Restricted device**: sommige Connect-apparaten (bv. "Kantoor") nemen geen wachtrij-commando's aan (403). `live.tsx`
  onthoudt dat apparaat (`restrictedDev`), probeert het niet steeds opnieuw en toont uitleg; bij een ander apparaat
  gaat het vanzelf weer door. Overzetten doen we nooit zelf.

## Leren van skips (`src/logic/learning.ts`)
Native module `modules/spotify-watcher` (Kotlin): voorgronddienst (specialUse) die de Spotify-broadcasts
`com.spotify.music.metadatachanged` / `playbackstatechanged` opvangt ("Apparaatuitzending" in Spotify aan)
en als JSON-regels wegschrijft; ook spraakherkenning via `RecognizerIntent` (nl-NL).
Signalen, sterk → zwak: doorspringen (2+ skips → doel), te vaak gedraaid (≥5× in 4 d → 14 d rust),
geen zin in (bekende los geskipt, per vibe), niet leuk (nieuw <30 s of in 3 sessies geskipt → vermoeden,
één keer vragen; later helemaal afgespeeld → vervalt; jouw antwoord gaat voor).

## Bouwen en controleren (sandbox zonder npm)
- `npm install` werkt lokaal niet; Google Maven/SDK ook niet. Wel: node 22, `tsc`, python3.
- Tests: `npm test` (node --experimental-strip-types). Logica-bestanden importeren elkaar met `.ts`-extensie.
- Typecheck lokaal: `./scripts/typecheck-local.sh` (stubs in `scripts/typecheck-stubs.d.ts`).
- CI `android.yml`: job `checks` (tests, expo install --fix, tsc) en job `build` (prebuild, Gradle, release).
  Fouten staan als annotations (`title=gradle|tsc|test`); lees ze via de API (check-runs → annotations).

## Architectuur
- `App.tsx`: fonts, providers, eigen route-stack (tabs DJ/Regels/Geleerd/Instellingen, `plan`, `now`), minispeler.
- `src/store.tsx`: state in AsyncStorage (`fdj-state-v1`): rules, learned, plans, history (pool), settings.
  Tokens (GitHub, Spotify) in SecureStore.
- `src/job.tsx`: lopende klussen (Claude-verzoek, wachtrij zetten) + Claude-status.
- `src/services/`: `spotify.ts` (PKCE, redirect `freakingdj://callback`), `github.ts`, `player.ts`
  (toevoegen/vervangen), `dj.ts` (verzoek → antwoord → opzoeken → regels), `watcher.ts`, `status.ts`.
- `src/live.tsx`: Live DJ-lus (zie boven).
- `src/logic/`: pure logica met tests (`rules`, `learning`, `pool`, `queue`, `live`, `adjust`, `status`, `text`, `base64`).

## Spotify Web API (development mode, 2026)
Beschikbaar: top items, recently played, saved tracks, search (max 10), player (queue get/add, play, next,
devices, volume). Weg: artist top tracks, new releases, popularity, batch-endpoints. Refresh-token ~6 maanden.
