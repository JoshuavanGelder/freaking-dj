import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useApp } from '../store';
import { C } from '../theme';
import { Button, Card, Chip, Field, H1, Row, Screen, Section, Sheet, T } from '../ui';
import {
  NOT_NOW_DAYS,
  REST_DAYS,
  REST_MIN_PLAYS,
  REST_WINDOW_DAYS,
  QUICK_SKIP_MS,
  SKIP_SESSIONS,
  addNotNow,
  clearNotNowGroup,
  moveNotNow,
  notNowGroups,
  removeNotNow,
  type NotNowGroup,
  type NotNowLine,
} from '../logic/learning';
import { vibeGroup, vibeGroupLabel } from '../logic/profiles';
import { norm } from '../logic/text';
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
          Een nieuw nummer binnen {QUICK_SKIP_MS / 1000} s geskipt, of in {SKIP_SESSIONS} sessies geskipt. Een reeks skips op rij telt hier niet mee. Blijft een vermoeden tot jij het bevestigt; speel je het later wel helemaal af, dan vervalt het.
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

      <NotNowSection />

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

type Editing = { mode: 'add' } | { mode: 'move'; line: NotNowLine };

/** "Geen zin in" per vibe: bekijken, toevoegen, naar een andere vibe verplaatsen en wissen. */
function NotNowSection() {
  const { state, signals, update } = useApp();
  const L = state.learned;
  const now = Date.now();
  const groups = notNowGroups(signals, now);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const name = (id: string) => {
    const m = L.meta[id];
    return m ? `${m.name} – ${m.artist}` : id;
  };
  const setLearned = (fn: (l: typeof L) => typeof L) => update((s) => ({ ...s, learned: fn(s.learned) }));

  return (
    <Section title="Geen zin in (per vibe)" right={<Button label="Toevoegen" icon="plus" small variant="dark" onPress={() => setEditing({ mode: 'add' })} />}>
      <T size={13} color={C.muted}>
        Een bekende favoriet los geskipt: het nummer is prima, maar paste niet bij die vibe. Telt {NOT_NOW_DAYS} dagen; zelf toegevoegd blijft staan tot je het wist. Een skip van een nummer dat je die dag al hoorde telt niet mee.
      </T>
      {groups.length ? (
        groups.map((g) => (
          <Card key={g.group} style={{ gap: 6 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T weight="bold">
                {vibeGroupLabel(g.group)} · {g.lines.length}
              </T>
              <Button
                label={confirm === g.group ? 'Zeker? Tik nog eens' : 'Alles wissen'}
                small
                variant={confirm === g.group ? 'danger' : 'ghost'}
                onPress={() => {
                  if (confirm !== g.group) return setConfirm(g.group);
                  setConfirm(null);
                  setLearned((l) => clearNotNowGroup(l, g, Date.now()));
                }}
              />
            </Row>
            {g.lines.map((line) => (
              <Row key={line.id} style={{ gap: 8, minHeight: 44 }}>
                <View style={{ flex: 1 }}>
                  <T size={14} numberOfLines={2}>
                    {name(line.id)}
                  </T>
                  <T size={12} color={C.dim}>
                    {line.manual ? 'zelf toegevoegd' : `geskipt op ${date(line.at)}`}
                  </T>
                </View>
                <Button label="Vibe" small variant="dark" onPress={() => setEditing({ mode: 'move', line })} />
                <Button label="Wissen" small variant="dark" onPress={() => setLearned((l) => removeNotNow(l, line.id, line.vibe, Date.now()))} />
              </Row>
            ))}
          </Card>
        ))
      ) : (
        <Empty text="Nog niets." />
      )}
      <NotNowSheet
        editing={editing}
        groups={groups}
        onClose={() => setEditing(null)}
        onSave={(trackId, vibe, meta) => {
          const e = editing;
          setEditing(null);
          if (!e) return;
          if (e.mode === 'move') setLearned((l) => moveNotNow(l, e.line.id, e.line.vibe, vibe, Date.now()));
          else setLearned((l) => addNotNow(l, trackId, vibe, Date.now(), meta));
        }}
      />
    </Section>
  );
}

type Known = { id: string; name: string; artist: string };

function NotNowSheet({
  editing,
  groups,
  onClose,
  onSave,
}: {
  editing: Editing | null;
  groups: NotNowGroup[];
  onClose: () => void;
  onSave: (trackId: string, vibe: string, meta?: { name: string; artist: string }) => void;
}) {
  const { state } = useApp();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Known | null>(null);
  const [vibe, setVibe] = useState('');
  const moving = editing?.mode === 'move' ? editing.line : null;

  // Vibes om uit te kiezen: de vaste drie, je recente vibes en die al in de lijst staan (één per groep).
  const vibes = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const v of ['Standaard', 'Gym', 'Worship', ...state.vibes, ...groups.map((g) => g.vibe), ...state.rules.quickVibes]) {
      const g = vibeGroup(v);
      if (!v.trim() || seen.has(g)) continue;
      seen.add(g);
      out.push(g === 'standaard' || g === 'gym' || g === 'worship' ? vibeGroupLabel(g) : v);
    }
    return out.slice(0, 12);
  }, [state.vibes, state.rules.quickVibes, groups]);

  // Nummers die de app kent: je luistergeschiedenis en alles wat al eens langskwam.
  const known = useMemo(() => {
    const map = new Map<string, Known>();
    for (const t of state.history?.pool ?? []) map.set(t.id, { id: t.id, name: t.name, artist: t.artists.join(', ') });
    for (const [id, m] of Object.entries(state.learned.meta)) if (!map.has(id)) map.set(id, { id, name: m.name, artist: m.artist });
    return [...map.values()];
  }, [state.history, state.learned.meta]);
  const q = norm(query);
  const matches = q.length >= 2 ? known.filter((k) => norm(`${k.name} ${k.artist}`).includes(q)).slice(0, 6) : [];

  const close = () => {
    setQuery('');
    setPicked(null);
    setVibe('');
    onClose();
  };
  const current = moving ? vibeGroup(moving.vibe) : null;
  const canSave = !!vibe.trim() && (moving ? vibeGroup(vibe) !== current : !!picked);
  const meta = state.learned.meta;

  return (
    <Sheet visible={!!editing} onClose={close}>
      <T size={18} weight="bold">
        {moving ? 'Naar een andere vibe' : 'Geen zin in toevoegen'}
      </T>
      {moving ? (
        <T size={14} color={C.muted}>
          {meta[moving.id] ? `${meta[moving.id].name} – ${meta[moving.id].artist}` : moving.id} · nu bij {vibeGroupLabel(vibeGroup(moving.vibe))}
        </T>
      ) : picked ? (
        <Row style={{ gap: 8 }}>
          <T size={14} style={{ flex: 1 }} numberOfLines={2}>
            {picked.name} – {picked.artist}
          </T>
          <Button label="Ander nummer" small variant="ghost" onPress={() => setPicked(null)} />
        </Row>
      ) : (
        <View style={{ gap: 6 }}>
          <Field value={query} onChangeText={setQuery} placeholder="Zoek een nummer of artiest" />
          {matches.map((k) => (
            <Button key={k.id} label={`${k.name} – ${k.artist}`} small variant="dark" style={{ justifyContent: 'flex-start' }} onPress={() => setPicked(k)} />
          ))}
          {q.length >= 2 && !matches.length ? (
            <T size={13} color={C.dim}>
              Niet gevonden in je geschiedenis.
            </T>
          ) : null}
        </View>
      )}
      <T size={13} weight="semibold" color={C.muted}>
        Bij welke vibe?
      </T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {vibes.map((v) => (
          <Chip key={v} label={v} on={vibeGroup(vibe) === vibeGroup(v) && !!vibe} onPress={() => setVibe(v)} />
        ))}
      </View>
      <Field value={vibe} onChangeText={setVibe} placeholder="Of typ een vibe" />
      <Button
        label={moving ? 'Verplaatsen' : 'Toevoegen'}
        disabled={!canSave}
        onPress={() => {
          const p = picked;
          setQuery('');
          setPicked(null);
          setVibe('');
          onSave(moving ? moving.id : p!.id, vibe.trim(), p ? { name: p.name, artist: p.artist } : undefined);
        }}
      />
    </Sheet>
  );
}
