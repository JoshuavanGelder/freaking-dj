import React, { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { useApp, type Model } from '../store';
import { useJob } from '../job';
import { C } from '../theme';
import { Banner, Button, Card, Chip, Field, H1, Row, Screen, Section, T, Toggle } from '../ui';
import * as sp from '../services/spotify';
import * as gh from '../services/github';
import type { Device } from '../logic/queue';
import { isWatching, lastEventAt, openBatterySettings, openSpotify, startWatcher, stopWatcher, watcherAvailable } from '../services/watcher';

const MODELS: { value: Model; label: string; hint: string }[] = [
  { value: 'sonnet', label: 'Sonnet', hint: 'aanbevolen: goede keuzes in ~15–20 s' },
  { value: 'opus', label: 'Opus', hint: 'beste keuzes, trager en meer verbruik' },
];

export function SettingsScreen() {
  const { state, update } = useApp();
  const { refreshHistory, health, refreshHealth } = useJob();
  const s = state.settings;
  const setS = (patch: Partial<typeof s>) => update((x) => ({ ...x, settings: { ...x.settings, ...patch } }));

  // Spotify
  const [clientId, setClientId] = useState(s.spotifyClientId);
  const [spotify, setSpotify] = useState<{ connected: boolean; name?: string; since?: number | null }>({ connected: false });
  const [spMsg, setSpMsg] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  // GitHub
  const [owner, setOwner] = useState(s.owner);
  const [repo, setRepo] = useState(s.repo);
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [ghMsg, setGhMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [histBusy, setHistBusy] = useState(false);
  const [, force] = useState(0);

  const loadSpotify = async () => {
    const connected = await sp.isConnected();
    let name: string | undefined;
    if (connected) name = (await sp.me().catch(() => null))?.name;
    setSpotify({ connected, name, since: await sp.loginAt() });
  };

  useEffect(() => {
    loadSpotify();
    gh.getToken().then((t) => setHasToken(!!t));
  }, []);

  const connect = async () => {
    setSpMsg(null);
    const id = clientId.trim();
    if (!id) {
      setSpMsg('Vul eerst de Client ID van je Spotify-app in.');
      return;
    }
    setS({ spotifyClientId: id });
    try {
      await sp.login(id);
      await loadSpotify();
      setHistBusy(true);
      await refreshHistory();
      setHistBusy(false);
    } catch (e: any) {
      setSpMsg(e?.message ?? String(e));
    }
  };

  const saveGithub = async () => {
    setS({ owner: owner.trim(), repo: repo.trim() });
    if (token.trim()) {
      await gh.setToken(token.trim());
      setToken('');
      setHasToken(true);
    }
    const problem = await gh.checkRepo({ owner: owner.trim(), repo: repo.trim() });
    setGhMsg(problem ? { ok: false, text: problem } : { ok: true, text: 'GitHub werkt. Claude draait via de workflow "DJ" in deze repo.' });
  };

  const monthsLeft = spotify.since ? Math.round(6 - (Date.now() - spotify.since) / (30 * 86400000)) : null;
  const last = lastEventAt();
  const lr = state.lastResponse;

  return (
    <Screen>
      <H1>Instellingen</H1>

      <Section title="Spotify">
        <Card>
          {spotify.connected ? (
            <T>
              Gekoppeld{spotify.name ? ` als ${spotify.name}` : ''}.
              {monthsLeft != null && monthsLeft <= 1 ? ' Spotify laat de koppeling na zo’n 6 maanden verlopen; koppel binnenkort opnieuw.' : ''}
            </T>
          ) : (
            <T color={C.muted} size={14}>
              Maak op developer.spotify.com een app (Web API), zet de redirect-URI hieronder erin en vul de Client ID in.
            </T>
          )}
          <Field label="Client ID" value={clientId} onChangeText={setClientId} placeholder="bv. 3f9a…" />
          <T size={13} weight="semibold" color={C.muted}>
            Redirect-URI
          </T>
          <Row style={{ gap: 8 }}>
            <T selectable style={{ flex: 1 }} weight="semibold">
              {sp.REDIRECT_URI}
            </T>
            <Button label="Kopieer" small variant="dark" onPress={() => Clipboard.setStringAsync(sp.REDIRECT_URI)} />
          </Row>
          {spMsg ? <Banner level="storing" text={spMsg} /> : null}
          <Row style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button label={spotify.connected ? 'Opnieuw koppelen' : 'Koppel Spotify'} small onPress={connect} />
            {spotify.connected ? (
              <Button
                label="Ontkoppelen"
                small
                variant="outline"
                onPress={async () => {
                  await sp.logout();
                  loadSpotify();
                }}
              />
            ) : null}
          </Row>
        </Card>
        {spotify.connected ? (
          <Card>
            <T size={14}>
              Luistergeschiedenis: {state.history ? `${state.history.pool.length} nummers, opgehaald ${new Date(state.history.fetchedAt).toLocaleString('nl-NL', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : 'nog niet opgehaald'}
            </T>
            <Button
              label={histBusy ? 'Ophalen…' : 'Nu vernieuwen'}
              small
              variant="dark"
              disabled={histBusy}
              style={{ alignSelf: 'flex-start' }}
              onPress={async () => {
                setHistBusy(true);
                await refreshHistory();
                setHistBusy(false);
              }}
            />
          </Card>
        ) : null}
      </Section>

      <Section title="Claude via GitHub">
        <Card>
          <T size={14} color={C.muted}>
            De app zet je verzoek in je repo; de workflow "DJ" draait daar de officiële Claude Code met jouw Claude-abonnement. Er is geen API-key nodig.
          </T>
          <Field label="GitHub-account" value={owner} onChangeText={setOwner} />
          <Field label="Repo" value={repo} onChangeText={setRepo} />
          <Field
            label={hasToken ? 'GitHub-token (opgeslagen; vul in om te vervangen)' : 'GitHub-token'}
            value={token}
            onChangeText={setToken}
            secure
            placeholder="github_pat_…"
          />
          <T size={12} color={C.dim}>
            Fine-grained token, alleen voor deze repo, met rechten Contents en Actions: lezen en schrijven.
          </T>
          {ghMsg ? <Banner level={ghMsg.ok ? 'ok' : 'storing'} text={ghMsg.text} /> : null}
          <Button label="Opslaan en controleren" small onPress={saveGithub} style={{ alignSelf: 'flex-start' }} />
        </Card>
        <Card>
          <T weight="bold">Claude-token (eenmalig)</T>
          <T size={14} color={C.muted}>
            Draai één keer op een computer met Claude Code: claude setup-token. Zet het token dat je krijgt in GitHub bij Settings → Secrets and variables → Actions als secret CLAUDE_CODE_OAUTH_TOKEN. Het blijft een jaar geldig.
          </T>
          <Button
            label="Open de secrets van je repo"
            small
            variant="dark"
            style={{ alignSelf: 'flex-start' }}
            onPress={() => Linking.openURL(`https://github.com/${s.owner}/${s.repo}/settings/secrets/actions`)}
          />
        </Card>
        <Card>
          <Row style={{ justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <T weight="semibold">Warme DJ</T>
              <T size={12} color={C.muted}>
                Als je de app opent, zet GitHub alvast een machine klaar die 10 minuten wacht. Dan heb je een voorstel in ~20 s in plaats van 1 à 2 minuten.
              </T>
            </View>
            <Toggle on={s.warmDj} label="Warme DJ" onChange={(v) => setS({ warmDj: v })} />
          </Row>
          <T size={12} color={C.dim}>
            Kost GitHub Actions-minuten: gratis bij een openbare repo, bij een privé-repo telt het mee voor je 2000 gratis minuten per maand (±10 min per keer openen).
          </T>
        </Card>
        <Card>
          <T weight="bold">Model</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {MODELS.map((m) => (
              <Chip key={m.value} label={m.label} on={s.model === m.value} onPress={() => setS({ model: m.value })} />
            ))}
          </View>
          <T size={12} color={C.dim}>
            {MODELS.find((m) => m.value === s.model)?.hint}. Alles gaat van je gewone Claude-limiet af.
          </T>
        </Card>
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <T weight="bold">Status</T>
            <Button label="Vernieuwen" small variant="dark" onPress={refreshHealth} />
          </Row>
          <Banner level={health.level === 'onbekend' ? 'info' : health.level} text={health.text} />
          {lr ? (
            <T size={12} color={C.dim}>
              Laatste run: {lr.status}
              {lr.durationMs ? ` in ${Math.round(lr.durationMs / 1000)} s` : ''} · {new Date(lr.finishedAt).toLocaleString('nl-NL', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
            </T>
          ) : null}
        </Card>
      </Section>

      <Section title="Meeluisteren">
        <Card>
          <Row style={{ justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <T weight="semibold">Leren van je skips</T>
              <T size={12} color={C.muted}>
                {watcherAvailable ? (isWatching() ? 'Aan' : 'Uit') : 'Niet beschikbaar in deze build'}
                {last ? ` · laatste signaal ${new Date(last).toLocaleString('nl-NL', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
              </T>
            </View>
            <Toggle
              on={s.watcher}
              label="Leren van je skips"
              onChange={async (v) => {
                setS({ watcher: v });
                if (v) await startWatcher();
                else await stopWatcher();
                force((x) => x + 1);
              }}
            />
          </Row>
          <T size={13} color={C.muted}>
            Zet in Spotify bij Instellingen → Afspelen "Apparaatuitzending" (Device Broadcast Status) aan. Samsung stopt apps op de achtergrond: zet de batterij van Freaking DJ op "Onbeperkt".
          </T>
          <Row style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button label="Open Spotify" small variant="dark" onPress={() => openSpotify()} />
            <Button label="Batterij-instellingen" small variant="dark" onPress={() => openBatterySettings()} />
          </Row>
          {!last && s.watcher ? <Banner level="let op" text="Nog geen signaal van Spotify ontvangen. Staat Apparaatuitzending aan?" /> : null}
          <T size={12} color={C.dim}>
            Werkt voor wat je op je telefoon luistert; van je pc en de Denon ziet de app alleen de geschiedenis.
          </T>
        </Card>
      </Section>

      <Section title="Spotify-apparaten">
        <Card>
          {devices ? (
            devices.length ? (
              devices.map((d) => (
                <T key={d.id ?? d.name} size={14}>
                  {d.isActive ? '▶ ' : ''}
                  {d.name} · {d.type}
                </T>
              ))
            ) : (
              <T size={14} color={C.muted}>
                Geen apparaten zichtbaar. Open Spotify ergens.
              </T>
            )
          ) : null}
          <Button label="Toon apparaten" small variant="dark" style={{ alignSelf: 'flex-start' }} onPress={() => sp.devices().then(setDevices).catch((e) => setSpMsg(e.message))} />
        </Card>
      </Section>

      <T size={12} color={C.dim}>
        Freaking DJ {Constants.expoConfig?.version ?? ''}
      </T>
    </Screen>
  );
}
