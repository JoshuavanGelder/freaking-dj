# Freaking DJ

Persoonlijke AI-DJ voor Spotify. Geef een vibe op ("coding", "gym", "Eurovisie", "begin met Morgan Wallen")
en de app stelt ~25 nummers (~90 min) samen uit je eigen luistergeschiedenis, met je eigen regels, en zet ze in
je Spotify-wachtrij. Claude draait via **je eigen Claude-abonnement** in GitHub Actions — geen API-key.

## Installeren
Open op je telefoon de nieuwste [release](../../releases/latest) en tik op het `.apk`-bestand.

## Eenmalig instellen

1. **Spotify-app** — op [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard): *Create app*,
   kies **Web API**, redirect-URI `freakingdj://callback`. Kopieer de **Client ID** naar Freaking DJ →
   Instellingen → Spotify → *Koppel Spotify*.
2. **GitHub-token** — [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new):
   fine-grained, alleen repo `freaking-dj`, rechten **Contents** en **Actions**: *Read and write*.
   Plak het in Instellingen → Claude via GitHub.
3. **Claude-token** — open een Codespace op deze repo (knop *Code → Codespaces*, kan op je telefoon) en draai
   `bash scripts/claude-token.sh`. Dat maakt het token met `claude setup-token`, test het en zet het meteen als
   secret **`CLAUDE_CODE_OAUTH_TOKEN`** (1 jaar geldig; daarna het script opnieuw draaien).
4. **Meeluisteren** — in Spotify: Instellingen → Afspelen → **Apparaatuitzending** aan. Zet de batterij van
   Freaking DJ op *Onbeperkt* (Samsung stopt anders de dienst).

## Hoe het werkt
- De app zet je verzoek (vibe, regels, wat hij geleerd heeft, je geschiedenis) in branch `dj-data` en start de
  workflow **DJ**. Die draait de officiële Claude Code met je abonnement en zet het antwoord terug.
  Zodra je de app opent, staat er een **warme DJ** klaar (10 minuten), zodat een voorstel ~20 seconden duurt in
  plaats van 1 à 2 minuten. Is je limiet op of het token verlopen, dan zie je dat in de app.
- De app controleert zelf de harde regels (blocklist, worship alleen op verzoek, geen dubbelen, niet twee keer
  dezelfde artiest achter elkaar, Eurovisie-favoriet) en zoekt nieuwe nummers op in Spotify.
- **Live DJ** zet steeds maar één nummer vooruit in je wachtrij en kiest het volgende pas als het vorige begint.
  Skip je iets, dan kiest hij meteen anders; bij veel skips of als de lijst bijna op is stuurt Claude op de
  achtergrond bij. Bijsturen ("rustiger", "meer NF") kan ook tussendoor, zonder dat het huidige nummer stopt.
- **Hele wachtrij**: **toevoegen** zet nummers alleen achteraan. **Vervangen** wacht tot het huidige nummer klaar is. Spotify kan
  de wachtrij niet leegmaken, dus oude nummers worden overgeslagen met het volume heel even op 0.
- Van je skips leert de app: te vaak gedraaid (2 weken rust), geen zin in (per vibe) en niet leuk (pas definitief
  als jij het bevestigt). Een reeks skips op rij en alles wat je in Live DJ skipt telt niet voor "niet leuk"; waar je
  naartoe skipte wordt niet gebruikt, want dat nummer koos je niet. Alles staat in de tab **Geleerd**.
