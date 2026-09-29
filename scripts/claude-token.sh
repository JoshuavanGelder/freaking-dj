#!/usr/bin/env bash
# Maakt een Claude-token (claude setup-token) en zet het meteen als secret CLAUDE_CODE_OAUTH_TOKEN
# in deze repo, zonder dat je iets hoeft te kopiëren. Bedoeld voor een GitHub Codespace (ook op je telefoon).
#
#   bash scripts/claude-token.sh
#
# Na een jaar verloopt het token: dan draai je dit script gewoon opnieuw.
set -uo pipefail
REPO="${REPO:-JoshuavanGelder/freaking-dj}"
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code installeren…"
  npm install -g @anthropic-ai/claude-code --no-audit --no-fund >/dev/null 2>&1 || {
    echo "Installeren mislukt."
    exit 1
  }
fi

cat <<'TXT'

== Stap 1: inloggen bij Claude ==
Er gaat een inlogpagina open. Log in en keur het goed.
Kom je daarna op een dode "localhost"-pagina? Kopieer dan die link uit de adresbalk,
open een tweede terminal (de + rechtsboven in het terminalpaneel) en typ daar:
    curl "PLAK-HIER-DE-LINK"
Daarna gaat dit script vanzelf verder.

TXT

# Uitvoer ook naar een bestand, zodat we het token er zelf uit kunnen halen.
claude setup-token 2>&1 | tee "$OUT"

TOKEN="$(python3 - "$OUT" <<'PY'
import re, sys
t = open(sys.argv[1], encoding="utf-8", errors="ignore").read()
t = re.sub(r"\x1b\][^\x07]*(\x07|\x1b\\)", "", t)          # OSC-codes
t = re.sub(r"\x1b\[[0-9;?]*[ -/]*[@-~]", "", t)             # kleur/cursor-codes
t = t.replace("\r\n", "\n").replace("\r", "\n")
ok = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")
i = t.rfind("sk-ant-oat01-")
if i < 0:
    print(""); sys.exit()
tok, j = "", i
while j < len(t):
    ch = t[j]
    if ch in ok:
        tok += ch; j += 1; continue
    # Het token kan over twee regels afgebroken zijn: precies één regeleinde + inspringing, dan verder.
    m = re.match(r"\n[ \t]*", t[j:])
    if m and j + m.end() < len(t) and t[j + m.end()] in ok:
        j += m.end(); continue
    break
print(tok)
PY
)"

if [ -z "$TOKEN" ]; then
  echo
  echo "Geen token gevonden in de uitvoer. Probeer het script opnieuw."
  exit 1
fi
echo
echo "Token gevonden: ${TOKEN:0:16}…${TOKEN: -4} (${#TOKEN} tekens)"

echo
echo "== Stap 2: token testen (één heel klein verzoek aan Claude) =="
if CLAUDE_CODE_OAUTH_TOKEN="$TOKEN" claude -p "Antwoord alleen met: ok" --max-turns 1 --tools "" >/dev/null 2>&1; then
  echo "Het token werkt."
else
  echo "Claude accepteert dit token niet. Draai het script opnieuw."
  exit 1
fi

echo
echo "== Stap 3: secret in GitHub zetten =="
if printf '%s' "$TOKEN" | gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo "$REPO" >/dev/null 2>&1; then
  :
else
  echo "GitHub vraagt eenmalig om in te loggen: er verschijnt een code van 8 tekens."
  echo "Open github.com/login/device, typ die code in en keur het goed."
  unset GITHUB_TOKEN GH_TOKEN
  gh auth login --hostname github.com --git-protocol https --web --scopes repo || exit 1
  printf '%s' "$TOKEN" | gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo "$REPO" || exit 1
fi
echo "Klaar: secret CLAUDE_CODE_OAUTH_TOKEN staat in $REPO."
echo "Je kunt deze codespace nu verwijderen via github.com/codespaces."
