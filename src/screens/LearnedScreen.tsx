import React from 'react';
import { View } from 'react-native';
import { useApp } from '../store';
import { C } from '../theme';
import { Button, Card, H1, Row, Screen, Section, T } from '../ui';
import { REST_DAYS, REST_MIN_PLAYS, REST_WINDOW_DAYS, QUICK_SKIP_MS, SKIP_SESSIONS } from '../logic/learning';
import { isWatching, lastEventAt } from '../services/watcher';

function date(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()}-${d.getMonth() + 1}`;
}

/** Alles wat de app over je geleerd heeft; je antwoord gaat altijd voor. */
export function LearnedScreen() {
  const { state, signals, decide, update } = useApp();
  const L = state.learned;
  const name = (id: string) => {
    const m = L.meta[id];
    return m ? `${m.name} – ${m.artist}` : id;
  };
  const now = Date.now();
  const week = L.plays.filter((p) => now - p.start < 7 * 86400000);
  const skips = week.filter((p) => p.outcome === 'skip').length;
  const resting = Object.entries(signals.resting).filter(([, until]) => until > now);
  const notNow = Object.entries(signals.notNow);
  const rejected = Object.entries(L.decisions).filter(([, d]) => d === 'afgewezen');
  const last = lastEventAt();

  const liftRest = (id: string) =>
    update((s) => {
      const manualRest = { ...s.learned.manualRest };
      delete manualRest[id];
      return { ...s, learned: { ...s.learned, manualRest, unrest: { ...(s.learned.unrest ?? {}), [id]: Date.now() } } };
    });

  return (
    <Screen>
      <H1>Geleerd</H1>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Stat label="Afgespeeld (7 d)" value={week.length} />
          <Stat label="Geskipt (7 d)" value={skips} />
          <Stat label="Niet leuk" value={signals.disliked.length} />
        </Row>
        <T size={12} color={C.dim}>
          {isWatching() ? 'Meeluisteren staat aan' : 'Meeluisteren staat uit'}
          {last ? ` · laatste signaal van Spotify: ${new Date(last).toLocaleString('nl-NL', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ' · nog geen signaal van Spotify ontvangen'}
        </T>
      </Card>

      <Section title="Vermoedelijk niet leuk">
        <T size={13} color={C.muted}>
          Een nieuw nummer binnen {QUICK_SKIP_MS / 1000} s geskipt, of in {SKIP_SESSIONS} sessies geskipt. Een reeks skips op rij en alles wat je in Live DJ skipt telt hier niet mee. Blijft een vermoeden tot jij het bevestigt; speel je het later wel helemaal af, dan vervalt het.
        </T>
        {signals.suspicions.length ? (
          signals.suspicions.map((s) => (
            <Card key={s.id} style={{ gap: 8 }}>
              <T weight="semibold">{s.name}</T>
              <T size={13} color={C.muted}>
                {s.artist} · {s.reason}
              </T>
              <Row style={{ gap: 8 }}>
                <Button label="Klopt, nooit meer" small onPress={() => decide(s.id, 'bevestigd')} />
                <Button label="Nee, prima" small variant="outline" onPress={() => decide(s.id, 'afgewezen')} />
              </Row>
            </Card>
          ))
        ) : (
          <Empty text="Geen vermoedens." />
        )}
      </Section>

      <Section title="Niet leuk (bevestigd)">
        {signals.disliked.length ? (
          signals.disliked.map((id) => (
            <Line key={id} text={name(id)} action="Toch wel leuk" onPress={() => decide(id, 'afgewezen')} />
          ))
        ) : (
          <Empty text="Nog niets." />
        )}
      </Section>

      <Section title="Even rust (te vaak gedraaid)">
        <T size={13} color={C.muted}>
          {REST_MIN_PLAYS}× of vaker gehoord in {REST_WINDOW_DAYS} dagen = ongeveer {REST_DAYS / 7} weken niet in je wachtrijen.
        </T>
        {resting.length ? (
          resting.map(([id, until]) => <Line key={id} text={`${name(id)} · tot ${date(until)}`} action="Rust opheffen" onPress={() => liftRest(id)} />)
        ) : (
          <Empty text="Niets in de rust." />
        )}
      </Section>

      <Section title="Geen zin in (per vibe)">
        <T size={13} color={C.muted}>
          Een bekende favoriet los geskipt: het nummer is prima, maar paste niet bij die vibe of dat moment.
        </T>
        {notNow.length ? (
          notNow.map(([id, list]) => (
            <Line key={id} text={`${name(id)} · ${[...new Set(list.map((l) => l.vibe))].join(', ')}`} />
          ))
        ) : (
          <Empty text="Nog niets." />
        )}
      </Section>

      {rejected.length ? (
        <Section title="Door jou goedgekeurd">
          {rejected.map(([id]) => (
            <Line key={id} text={name(id)} action="Wissen" onPress={() => decide(id, null)} />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <T size={24} weight="black">
        {value}
      </T>
      <T size={12} color={C.muted}>
        {label}
      </T>
    </View>
  );
}

function Line({ text, action, onPress }: { text: string; action?: string; onPress?: () => void }) {
  return (
    <Row style={{ gap: 10, minHeight: 40 }}>
      <T size={14} style={{ flex: 1 }} numberOfLines={2}>
        {text}
      </T>
      {action && onPress ? <Button label={action} small variant="dark" onPress={onPress} /> : null}
    </Row>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <T size={14} color={C.dim}>
      {text}
    </T>
  );
}
