import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState as RNAppState, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../store';
import { useJob } from '../job';
import { useNav } from '../nav';
import { C } from '../theme';
import { Icon } from '../icons';
import { Banner, Bar, Cover, H1, IconButton, Row, T, TrackRow } from '../ui';
import { snapshot, type Snapshot } from '../services/player';

function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Wat er nu speelt en wat er komt. */
export function NowScreen() {
  const { state } = useApp();
  const { job, error } = useJob();
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      setSnap(await snapshot());
      setErr(null);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (RNAppState.currentState === 'active') load();
    }, 5000);
    const t2 = setInterval(() => setTick((x) => x + 1), 1000);
    return () => {
      clearInterval(t);
      clearInterval(t2);
    };
  }, [load]);

  // Welke nummers kwamen uit een voorstel (en uit welke vibe)?
  const fromPlan = new Map<string, { vibe: string; isNew: boolean }>();
  for (const p of [...state.plans].reverse()) for (const it of p.items) fromPlan.set(it.track.id, { vibe: p.vibe, isNew: it.isNew });

  const pb = snap?.playback;
  const item = pb?.item ?? snap?.current ?? null;
  const progress = pb ? pb.progressMs + (pb.isPlaying ? Date.now() - pb.at : 0) : 0;
  void tick;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: insets.bottom + 30, gap: 18 }}>
        <Row style={{ justifyContent: 'space-between', marginLeft: -8 }}>
          <IconButton icon="back" label="Terug" onPress={nav.back} color={C.ink} />
          <T size={13} weight="bold" color={C.muted} style={{ letterSpacing: 1 }}>
            NU
          </T>
          <IconButton icon="refresh" label="Vernieuwen" onPress={load} color={C.ink} />
        </Row>

        {job?.kind === 'queue' ? (
          <Row style={{ gap: 10, backgroundColor: C.card, borderRadius: 8, padding: 12 }}>
            <ActivityIndicator color={C.accent} />
            <T style={{ flex: 1 }}>{job.status}</T>
          </Row>
        ) : null}
        {error ? <Banner level="storing" text={`${error.title}. ${error.message}`} /> : null}
        {err ? <Banner level="let op" text={err} /> : null}

        {!snap && !err ? <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} /> : null}

        {snap && !item ? (
          <View style={{ alignItems: 'center', gap: 10, marginTop: 30 }}>
            <Icon name="music" size={48} color={C.dim} />
            <T color={C.muted}>Er speelt nu niets.</T>
          </View>
        ) : null}

        {item ? (
          <View style={{ gap: 14 }}>
            <View style={{ alignItems: 'center' }}>
              <Cover uri={item.image} size={260} radius={6} />
            </View>
            <View style={{ gap: 4 }}>
              <H1 style={{ fontSize: 24 }}>{item.name}</H1>
              <T color={C.muted}>{item.artists.join(', ')}</T>
            </View>
            <View style={{ gap: 6 }}>
              <Bar pct={(100 * progress) / (item.durationMs || 1)} />
              <Row style={{ justifyContent: 'space-between' }}>
                <T size={12} color={C.muted}>
                  {mmss(progress)}
                </T>
                <T size={12} color={C.muted}>
                  {mmss(item.durationMs)}
                </T>
              </Row>
            </View>
            {pb?.device ? (
              <Row style={{ gap: 8 }}>
                <Icon name="device" size={16} color={C.accent} />
                <T size={13} weight="semibold" color={C.accent}>
                  {pb.isPlaying ? 'Speelt op' : 'Gepauzeerd op'} {pb.device.name}
                </T>
              </Row>
            ) : null}
          </View>
        ) : null}

        {snap && snap.queue.length ? (
          <View style={{ gap: 8 }}>
            <T size={18} weight="bold">
              Wat er komt
            </T>
            {snap.queue.slice(0, 30).map((t, i) => {
              const src = fromPlan.get(t.id);
              return (
                <TrackRow
                  key={`${t.id}-${i}`}
                  title={t.name}
                  artist={src ? `${t.artists.join(', ')} · ${src.vibe}` : t.artists.join(', ')}
                  image={t.image}
                  isNew={src?.isNew}
                />
              );
            })}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
