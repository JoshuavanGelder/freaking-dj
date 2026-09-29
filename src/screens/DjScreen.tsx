import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, TextInput, View } from 'react-native';
import { useApp } from '../store';
import { useJob } from '../job';
import { useNav } from '../nav';
import { C, F } from '../theme';
import { Icon } from '../icons';
import { Banner, Button, Card, Chip, H1, Row, Screen, Section, T } from '../ui';
import * as sp from '../services/spotify';
import * as gh from '../services/github';
import { listen, speechAvailable } from '../services/watcher';
import { openQuestions } from '../logic/learning';
import { totalMinutes } from '../logic/rules';

function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 6) return 'Goedenacht';
  if (h < 12) return 'Goedemorgen';
  if (h < 18) return 'Goedemiddag';
  return 'Goedenavond';
}

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'net';
  if (m < 60) return `${m} min geleden`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} uur geleden`;
  return `${Math.round(h / 24)} d geleden`;
}

export function DjScreen() {
  const { state, signals, decide } = useApp();
  const { job, error, clearError, health, requestPlan, cancel } = useJob();
  const nav = useNav();
  const [text, setText] = useState('');
  const [setup, setSetup] = useState<{ spotify: boolean; github: boolean } | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    Promise.all([sp.isConnected(), gh.getToken()]).then(([s, g]) => setSetup({ spotify: s, github: !!g }));
  }, [state.settings]);

  useEffect(() => {
    if (!job) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - job.startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [job]);

  const go = async (vibe: string) => {
    const v = vibe.trim();
    if (!v || job) return;
    setText('');
    const plan = await requestPlan(v);
    if (plan) nav.push({ name: 'plan', planId: plan.id });
  };

  const speak = async () => {
    try {
      const said = await listen('Welke vibe wil je?');
      if (said) {
        setText(said);
        go(said);
      }
    } catch {
      /* geen spraak beschikbaar */
    }
  };

  const question = openQuestions(signals, state.learned)[0];
  const tiles = state.rules.quickVibes;

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <H1>{greeting()}</H1>
        <StatusDot level={health.level} />
      </Row>

      {health.level === 'storing' || health.level === 'let op' ? <Banner level={health.level} text={health.text} /> : null}

      {setup && (!setup.spotify || !setup.github) ? (
        <Card>
          <T weight="bold" size={16}>
            Nog even instellen
          </T>
          <T color={C.muted} size={14}>
            {!setup.spotify ? '• Koppel Spotify\n' : ''}
            {!setup.github ? '• Zet je GitHub-token (daarmee draait Claude via je abonnement)\n' : ''}• Zet het Claude-token als secret in GitHub (zie Instellingen)
          </T>
          <Button label="Naar Instellingen" small variant="dark" onPress={() => nav.setTab('instellingen')} style={{ alignSelf: 'flex-start' }} />
        </Card>
      ) : null}

      {error ? (
        <Banner
          level="storing"
          text={`${error.title}. ${error.message}`}
          action={error.url ? { label: 'Bekijk de run op GitHub', onPress: () => Linking.openURL(error.url!) } : { label: 'Oké', onPress: clearError }}
        />
      ) : null}

      {job?.kind === 'dj' ? (
        <Card style={{ backgroundColor: C.cardHi }}>
          <Row style={{ gap: 12 }}>
            <ActivityIndicator color={C.accent} />
            <View style={{ flex: 1 }}>
              <T weight="bold" numberOfLines={1}>
                {job.vibe}
              </T>
              <T size={13} color={C.muted}>
                {job.status}
              </T>
            </View>
            <T size={13} color={C.muted}>
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
            </T>
          </Row>
          <T size={12} color={C.dim}>
            Claude draait in GitHub Actions met je abonnement; dat duurt meestal 1 à 2 minuten. Je kunt de app gewoon wegleggen.
          </T>
          <Button label="Stoppen" small variant="outline" onPress={cancel} style={{ alignSelf: 'flex-start' }} />
        </Card>
      ) : null}

      {/* Zoekbalk zoals in Spotify */}
      <Row style={{ backgroundColor: C.white, borderRadius: 6, height: 50, paddingLeft: 12, gap: 8 }}>
        <Icon name="spark" size={22} color="#121212" />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Welke vibe wil je?"
          placeholderTextColor="#535353"
          onSubmitEditing={() => go(text)}
          returnKeyType="go"
          editable={!job}
          style={{ flex: 1, fontFamily: F.semibold, fontSize: 16, color: '#121212', height: 50 }}
        />
        {speechAvailable ? (
          <Pressable accessibilityLabel="Inspreken" onPress={speak} hitSlop={6} style={{ width: 44, height: 50, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="mic" size={22} color="#121212" />
          </Pressable>
        ) : null}
        {text.trim() ? (
          <Pressable accessibilityLabel="Maak wachtrij" onPress={() => go(text)} style={{ width: 50, height: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accent, borderTopRightRadius: 6, borderBottomRightRadius: 6 }}>
            <Icon name="send" size={22} color={C.onAccent} strokeWidth={2.6} />
          </Pressable>
        ) : null}
      </Row>

      {state.vibes.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {state.vibes.slice(0, 6).map((v) => (
            <Chip key={v} label={v} onPress={() => go(v)} />
          ))}
        </View>
      ) : null}

      {question ? (
        <Card style={{ backgroundColor: C.cardHi }}>
          <Row style={{ gap: 8 }}>
            <Icon name="learned" size={18} color={C.accent} />
            <T size={12} weight="bold" color={C.accent}>
              EVEN CHECKEN
            </T>
          </Row>
          <T weight="bold" size={16}>
            {question.question}
          </T>
          <Row style={{ gap: 8 }}>
            <Button label="Ja, nooit meer" small onPress={() => decide(question.id, 'bevestigd')} />
            <Button label="Nee, prima" small variant="outline" onPress={() => decide(question.id, 'afgewezen')} />
          </Row>
        </Card>
      ) : null}

      <Section title="Snel starten">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {tiles.map((v, i) => (
            <Pressable
              key={v}
              onPress={() => go(v)}
              style={({ pressed }) => ({
                width: '48%',
                flexGrow: 1,
                height: 86,
                borderRadius: 8,
                padding: 12,
                backgroundColor: C.tiles[i % C.tiles.length],
                overflow: 'hidden',
                opacity: job ? 0.5 : pressed ? 0.8 : 1,
              })}
            >
              <T size={18} weight="black">
                {v}
              </T>
              <View style={{ position: 'absolute', right: -14, bottom: -14, transform: [{ rotate: '25deg' }] }}>
                <Icon name="music" size={62} color="#00000040" strokeWidth={2.4} />
              </View>
            </Pressable>
          ))}
        </View>
      </Section>

      {state.plans.length ? (
        <Section title="Recente wachtrijen">
          {state.plans.slice(0, 6).map((p) => (
            <Pressable key={p.id} onPress={() => nav.push({ name: 'plan', planId: p.id })} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
              <Row style={{ gap: 12 }}>
                <View style={{ width: 48, height: 48, borderRadius: 4, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="queue" size={22} color={C.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <T weight="semibold" numberOfLines={1}>
                    {p.title}
                  </T>
                  <T size={13} color={C.muted} numberOfLines={1}>
                    {p.vibe} · {p.items.length} nummers · {totalMinutes(p.items)} min · {ago(p.createdAt)}
                  </T>
                </View>
                <Icon name="chevron" size={20} color={C.muted} />
              </Row>
            </Pressable>
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

function StatusDot({ level }: { level: 'ok' | 'let op' | 'storing' | 'onbekend' }) {
  const color = level === 'ok' ? C.accent : level === 'let op' ? C.amber : level === 'storing' ? C.warn : C.dim;
  const label = level === 'ok' ? 'Claude' : level === 'onbekend' ? 'Claude ?' : 'Claude';
  return (
    <Row style={{ gap: 6, backgroundColor: C.card, borderRadius: 999, paddingHorizontal: 10, height: 28 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
      <T size={12} weight="semibold" color={C.muted}>
        {label}
      </T>
    </Row>
  );
}
