import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../store';
import { useJob } from '../job';
import { useLive } from '../live';
import { useNav } from '../nav';
import { C } from '../theme';
import { Icon } from '../icons';
import { Banner, Button, Chip, Field, H1, IconButton, Row, Sheet, T, Toggle, TrackRow } from '../ui';
import { groupByStyle, parseVibe, pickReplacement, totalMinutes } from '../logic/rules';
import { dislikedKeys } from '../logic/learning';
import { hasOldQueue } from '../logic/queue';
import { snapshot } from '../services/player';

const ADJUST = ['Rustiger', 'Harder', 'Meer bekend', 'Meer nieuw', 'Meer oude favorieten'];

export function PlanScreen({ planId }: { planId: string }) {
  const { state, signals, savePlan } = useApp();
  const { job, error, clearError, requestPlan, sendToSpotify } = useJob();
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const plan = state.plans.find((p) => p.id === planId);
  const [adjust, setAdjust] = useState('');
  const [sheet, setSheet] = useState<{ old: number; live: boolean } | null>(null);
  const live = useLive();
  const [allowSkip, setAllowSkip] = useState(false);
  const [checking, setChecking] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);

  const groups = useMemo(() => (plan ? groupByStyle(plan.items) : []), [plan]);
  if (!plan) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 20, padding: 16, gap: 12 }}>
        <T>Deze wachtrij bestaat niet meer.</T>
        <Button label="Terug" variant="outline" onPress={nav.back} />
      </View>
    );
  }
  const newCount = plan.items.filter((i) => i.isNew).length;
  const parent = plan.parentId ? state.plans.find((p) => p.id === plan.parentId) : undefined;
  const added = new Set(plan.addedIds ?? []);
  const busy = !!job || !!live.starting;

  const swap = (index: number) => {
    const ctx = {
      rules: state.rules,
      vibe: parseVibe(plan.vibe, state.rules),
      signals,
      now: Date.now(),
      dislikedKeys: dislikedKeys(signals, state.learned),
    };
    const r = pickReplacement(plan.items, plan.spares, index, state.history?.pool ?? [], ctx);
    if (!r) return;
    const items = plan.items.map((it, i) => (i === index ? r.item : it));
    savePlan({ ...plan, items, spares: r.spares });
  };

  const tweak = async (what: string) => {
    const a = what.trim();
    if (!a || busy) return;
    setAdjust('');
    const next = await requestPlan(plan.vibe, { adjust: a, previous: plan });
    if (next) nav.replace({ name: 'plan', planId: next.id });
  };

  const toSpotify = async (asLive: boolean) => {
    setChecking(true);
    clearError();
    try {
      const snap = await snapshot();
      const ids = plan.items.map((i) => i.track.id);
      if (hasOldQueue(snap.queue.map((t) => t.id), ids)) {
        setSheet({ old: snap.queue.filter((t) => !ids.includes(t.id)).length, live: asLive });
      } else {
        await run('toevoegen', asLive);
      }
    } catch (e: any) {
      // Geen apparaat of geen verbinding: gewoon proberen toe te voegen (de speler geeft een nette melding).
      await run('toevoegen', asLive);
    } finally {
      setChecking(false);
    }
  };

  const run = async (mode: 'toevoegen' | 'vervangen', asLive: boolean) => {
    setSheet(null);
    const ok = asLive ? await live.start(plan, mode, allowSkip) : await sendToSpotify(plan, mode, allowSkip);
    if (ok) nav.replace({ name: 'now' });
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: 110, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Row style={{ marginLeft: -8 }}>
          <IconButton icon="back" label="Terug" onPress={nav.back} color={C.ink} />
        </Row>
        <View style={{ gap: 6 }}>
          <H1>{plan.title}</H1>
          <T size={14} color={C.muted}>
            {plan.vibe} · {plan.items.length} nummers · {totalMinutes(plan.items)} min{newCount ? ` · ${newCount} nieuw` : ''}
          </T>
          {plan.note ? (
            <T size={14} color={C.muted} style={{ marginTop: 4 }}>
              {plan.note}
            </T>
          ) : null}
        </View>

        {parent ? (
          <Row style={{ gap: 10, backgroundColor: C.card, borderRadius: 8, padding: 12 }}>
            <Icon name="swap" size={18} color={C.accent} />
            <T size={14} style={{ flex: 1 }}>
              Bijgestuurd{plan.change ? `: ${plan.change}` : ''}.
            </T>
            <Button label="Vorige versie" small variant="dark" onPress={() => nav.replace({ name: 'plan', planId: parent.id })} />
          </Row>
        ) : null}

        {error ? <Banner level="storing" text={`${error.title}. ${error.message}`} action={{ label: 'Oké', onPress: clearError }} /> : null}

        {/* Bijsturen */}
        <View style={{ gap: 10 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {ADJUST.map((a) => (
              <Chip key={a} label={a} onPress={() => tweak(a.toLowerCase())} />
            ))}
          </ScrollView>
          <Row style={{ gap: 8 }}>
            <Field value={adjust} onChangeText={setAdjust} placeholder='Bv. "doe er Ordinary bij" of "rustiger"' onSubmit={() => tweak(adjust)} style={{ flex: 1 }} />
            <IconButton icon="send" label="Bijsturen" onPress={() => tweak(adjust)} bg={C.cardHi} color={C.ink} size={46} />
          </Row>
          {job?.kind === 'dj' ? (
            <Row style={{ gap: 10 }}>
              <ActivityIndicator color={C.accent} />
              <T size={13} color={C.muted} style={{ flex: 1 }}>
                {job.status}
              </T>
            </Row>
          ) : null}
        </View>

        {groups.map((g) => (
          <View key={g.style} style={{ gap: 6 }}>
            <T size={13} weight="bold" color={C.muted} style={{ letterSpacing: 1, textTransform: 'uppercase', marginTop: 6 }}>
              {g.style}
            </T>
            {g.entries.map(({ item, index }) => (
              <TrackRow
                key={`${item.track.id}-${index}`}
                index={index + 1}
                title={item.track.name}
                artist={item.track.artists.join(', ')}
                image={item.track.image}
                isNew={item.isNew}
                highlight={added.has(item.track.id)}
                right={<IconButton icon="swap" label={`${item.track.name} wisselen`} onPress={() => swap(index)} iconSize={20} />}
              />
            ))}
          </View>
        ))}

        {plan.unresolved.length ? (
          <T size={13} color={C.dim}>
            Niet gevonden op Spotify: {plan.unresolved.join(', ')}.
          </T>
        ) : null}

        {plan.removed.length ? (
          <Pressable onPress={() => setShowRemoved((v) => !v)}>
            <T size={13} color={C.dim}>
              {plan.removed.length} weggelaten door je regels {showRemoved ? '▲' : '▼'}
            </T>
            {showRemoved
              ? plan.removed.map((r, i) => (
                  <T key={i} size={13} color={C.dim}>
                    • {r.title} – {r.artist} ({r.reason})
                  </T>
                ))
              : null}
          </Pressable>
        ) : null}
      </ScrollView>

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 12, backgroundColor: '#121212F2' }}>
        {job?.kind === 'queue' || live.starting ? (
          <Row style={{ gap: 10, justifyContent: 'center', height: 50 }}>
            <ActivityIndicator color={C.accent} />
            <T weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
              {live.starting ?? job?.status}
            </T>
          </Row>
        ) : (
          <Row style={{ gap: 10 }}>
            <Button label={checking ? 'Bekijken…' : 'Live DJ'} icon="spark" onPress={() => toSpotify(true)} disabled={busy || checking} style={{ flex: 1 }} />
            <Button label="Hele wachtrij" variant="outline" onPress={() => toSpotify(false)} disabled={busy || checking} style={{ flex: 1, paddingHorizontal: 12 }} />
          </Row>
        )}
        {live.error ? (
          <T size={12} color={C.warn} style={{ marginTop: 6 }}>
            {live.error}
          </T>
        ) : null}
      </View>

      <Sheet visible={!!sheet} onClose={() => setSheet(null)}>
        <T size={18} weight="bold">
          Er staan nog {sheet?.old ?? 0} nummers in je wachtrij
        </T>
        <T size={14} color={C.muted}>
          {sheet?.live
            ? 'Live DJ zet steeds één nummer vooruit. Achteraan: hij begint na je huidige wachtrij. Vervangen: de oude wachtrij gaat weg zodra het huidige nummer klaar is.'
            : `Toevoegen zet deze ${plan.items.length} nummers achteraan. Vervangen haalt de oude wachtrij echt weg; dat gebeurt pas als het huidige nummer klaar is.`}
        </T>
        <Row style={{ justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <T weight="semibold">Huidig nummer mag geskipt worden</T>
            <T size={12} color={C.muted}>
              Alleen bij vervangen: dan begint de nieuwe wachtrij meteen.
            </T>
          </View>
          <Toggle on={allowSkip} onChange={setAllowSkip} label="Huidig nummer mag geskipt worden" />
        </Row>
        <Button label={sheet?.live ? 'Na mijn wachtrij beginnen' : 'Toevoegen achteraan'} onPress={() => run('toevoegen', !!sheet?.live)} />
        <Button label="Vervangen" variant="outline" onPress={() => run('vervangen', !!sheet?.live)} />
        <Row style={{ gap: 6 }}>
          <Icon name="alert" size={14} color={C.dim} />
          <T size={12} color={C.dim} style={{ flex: 1 }}>
            Spotify kan de wachtrij niet leegmaken; bij vervangen slaat de app oude nummers over met het volume heel even op 0.
          </T>
        </Row>
      </Sheet>
    </View>
  );
}
