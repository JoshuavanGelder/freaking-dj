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
  addNotNow,
  clearNotNowGroup,
  moveNotNow,
  notNowGroups,
  removeNotNow,
  type NotNowGroup,
  type NotNowLine,
} from '../logic/learning';
import { vibeGroup, vibeGroupLabel } from '../logic/profiles';
import type { Pattern } from '../logic/types';
import { GROUP_WHERE, PATTERN, approvePattern, neverPattern, unapproveArtist, unapproveSong } from '../logic/patterns';
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
  const okSongs = Object.entries(L.songOk ?? {});
  const okArtists = Object.entries(L.artistOk ?? {});
  const gone = signals.patterns.filter((p) => p.level === 'weg');
  const paused = signals.patterns.filter((p) => p.level === 'pauze');
  const less = signals.patterns.filter((p) => p.level === 'minder');
  const styles = signals.styles ?? [];
  const last = lastEventAt();

  const liftRest = (id: string) =>
    update((s) => {
      const manualRest = { ...s.learned.manualRest };
      delete manualRest[id];
      return { ...s, learned: { ...s.learned, manualRest, unrest: { ...(s.learned.unrest ?? {}), [id]: Date.now() } } };
    });

  /** Toch leuk: skips tot nu tellen niet meer (alle versies, alle vibes). */
  const okay = (p: Pattern) => update((s) => ({ ...s, learned: approvePattern(s.learned, p, Date.now()) }));
  /** Nooit meer: nummer vast niet-leuk, artiest op de blocklist (in Regels weer weg te halen). */
  const never = (p: Pattern) =>
    update((s) => {
      const learned = neverPattern(s.learned, p, Date.now());
      if (p.kind === 'song') return { ...s, learned };
      const blocked = s.rules.blockedArtists.some((a) => norm(a) === p.key) ? s.rules.blockedArtists : [...s.rules.blockedArtists, p.name];
      return { ...s, learned, rules: { ...s.rules, blockedArtists: blocked } };
    });

  return (
    <Screen>
      <H1>Geleerd</H1>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Stat label="Afgespeeld (7 d)" value={week.length} />
          <Stat label="Geskipt (7 d)" value={skips} />
          <Stat label="Weggelaten" value={signals.disliked.length + gone.length} />
        </Row>
        <T size={12} color={C.dim}>
          {isWatching() ? 'Meeluisteren staat aan' : 'Meeluisteren staat uit'}
          {last ? ` · laatste signaal van Spotify: ${new Date(last).toLocaleString('nl-NL', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ' · nog geen signaal van Spotify ontvangen'}
        </T>
      </Card>

      <Section title="Waarschijnlijk niet meer leuk">
        <T size={13} color={C.muted}>
          De DJ zoekt zelf patronen in je skips; je hoeft niets te beantwoorden. Eén skip zegt niks. Skip je hetzelfde nummer steeds, of steeds nummers van dezelfde artiest, over meerdere dagen, dan laat hij het {PATTERN.goneWeeks} weken weg. Daarna komt het één keer terug als test. Luister je het zelf helemaal af, dan begint de telling opnieuw.
        </T>
        {gone.length ? gone.map((p) => <PatternCard key={`${p.kind}${p.key}${p.vibe}`} p={p} onOk={() => okay(p)} onNever={() => never(p)} />) : <Empty text="Niets." />}
      </Section>

      <Section title="Even minder vaak">
        <T size={13} color={C.muted}>
          Een skip in de eerste 30 seconden telt helemaal, tot de helft half, daarna niet (dan wilde je gewoon iets anders). Bekend nummer {PATTERN.knownLess}× geskipt, nieuw nummer {PATTERN.newLess === 0.5 ? 'één keer' : PATTERN.newLess}, of {PATTERN.artistLess} verschillende nummers van een artiest. Gym en Worship leren apart. Vervalt na {PATTERN.lessExpireDays} dagen zonder nieuwe skip.
        </T>
        {less.length ? less.map((p) => <PatternCard key={`${p.kind}${p.key}${p.vibe}`} p={p} onOk={() => okay(p)} />) : null}
        {styles.map((h) => (
          <Line key={`${h.group}${h.style}`} text={`Stijl: ${h.style} · ${GROUP_WHERE[h.group]} · ${h.artists} artiesten geskipt (alleen een hint aan de DJ)`} />
        ))}
        {!less.length && !styles.length ? <Empty text="Niets." /> : null}
      </Section>

      {signals.disliked.length ? (
        <Section title="Nooit meer (door jou)">
          {signals.disliked.map((id) => (
            <Line key={id} text={name(id)} action="Toch wel leuk" onPress={() => decide(id, 'afgewezen')} />
          ))}
        </Section>
      ) : null}

      <Section title="Even rust (te vaak gehoord)">
        <T size={13} color={C.muted}>
          {REST_MIN_PLAYS}× of vaker gehoord in {REST_WINDOW_DAYS} dagen = ongeveer {REST_DAYS / 7} weken niet in je wachtrijen. Een favoriet die je eerst vaak hoorde en nu steeds skipt, krijgt {PATTERN.pauseDays} dagen pauze in plaats van "niet meer leuk".
        </T>
        {resting.map(([id, until]) => (
          <Line key={id} text={`${name(id)} · tot ${date(until)}`} action="Rust opheffen" onPress={() => liftRest(id)} />
        ))}
        {paused.map((p) => (
          <Line key={`p${p.key}`} text={`${p.name} – ${p.artist} · tot ${date(p.until ?? now)}`} action="Rust opheffen" onPress={() => okay(p)} />
        ))}
        {!resting.length && !paused.length ? <Empty text="Niets in de rust." /> : null}
      </Section>

      <NotNowSection />

      {rejected.length || okSongs.length || okArtists.length ? (
        <Section title="Door jou goedgekeurd">
          <T size={13} color={C.muted}>
            Skips van vóór je goedkeuring tellen niet meer. Skip je het daarna weer steeds, dan merkt de DJ dat opnieuw.
          </T>
          {rejected.map(([id]) => (
            <Line key={id} text={name(id)} action="Wissen" onPress={() => decide(id, null)} />
          ))}
          {okSongs.map(([key, a]) => (
            <Line key={key} text={`${a.name} – ${a.artist}`} action="Wissen" onPress={() => update((s) => ({ ...s, learned: unapproveSong(s.learned, key) }))} />
          ))}
          {okArtists.map(([key, a]) => (
            <Line key={key} text={`Artiest: ${a.name}`} action="Wissen" onPress={() => update((s) => ({ ...s, learned: unapproveArtist(s.learned, key) }))} />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

/** Eén patroon: wat, waarom, waar het geldt en tot wanneer. */
function PatternCard({ p, onOk, onNever }: { p: Pattern; onOk: () => void; onNever?: () => void }) {
  const where = p.vibe ? GROUP_WHERE[p.vibe] : 'overal';
  const until = p.level === 'weg' && p.until ? ` · tot ${date(p.until)}, dan één keer als test` : '';
  return (
    <Card style={{ gap: 8 }}>
      <T weight="semibold" numberOfLines={2}>
        {p.kind === 'artist' ? `Artiest: ${p.name}` : p.name}
      </T>
      <T size={13} color={C.muted}>
        {p.kind === 'song' ? `${p.artist} · ` : ''}
        {p.reason} · {where}
        {until}
      </T>
      <Row style={{ gap: 8 }}>
        <Button label="Toch leuk" small variant="outline" onPress={onOk} />
        {onNever ? <Button label="Nooit meer" small variant="dark" onPress={onNever} /> : null}
      </Row>
    </Card>
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
