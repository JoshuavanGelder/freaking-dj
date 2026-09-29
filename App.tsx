import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState as RNAppState, BackHandler, Pressable, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Figtree_400Regular, Figtree_600SemiBold, Figtree_700Bold, Figtree_800ExtraBold } from '@expo-google-fonts/figtree';
import { AppProvider, useApp } from './src/store';
import { JobProvider, useJob } from './src/job';
import { Nav, NavProvider, Route, Tab, useNav } from './src/nav';
import { C, F } from './src/theme';
import { Icon, IconName } from './src/icons';
import { Cover, T } from './src/ui';
import * as sp from './src/services/spotify';
import { pullEvents, startWatcher, stopWatcher } from './src/services/watcher';
import { DjScreen } from './src/screens/DjScreen';
import { PlanScreen } from './src/screens/PlanScreen';
import { NowScreen } from './src/screens/NowScreen';
import { RulesScreen } from './src/screens/RulesScreen';
import { LearnedScreen } from './src/screens/LearnedScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';

export default function App() {
  const [fontsLoaded, fontError] = useFonts({ Figtree_400Regular, Figtree_600SemiBold, Figtree_700Bold, Figtree_800ExtraBold });
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AppProvider>
        <JobProvider>{fontsLoaded || fontError ? <Root /> : <Loading />}</JobProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}

function Loading() {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={C.accent} />
    </View>
  );
}

/** Leest elke minuut (en bij terugkomen in de app) wat de meeluister-dienst opving. */
function useWatcher() {
  const { state, loaded, addEvents } = useApp();
  const on = state.settings.watcher;
  useEffect(() => {
    if (!loaded) return;
    if (on) startWatcher().catch(() => undefined);
    else stopWatcher().catch(() => undefined);
  }, [loaded, on]);
  useEffect(() => {
    if (!loaded) return;
    const pull = () => pullEvents().then(addEvents).catch(() => undefined);
    pull();
    const timer = setInterval(pull, 60_000);
    const sub = RNAppState.addEventListener('change', (s) => {
      if (s === 'active') pull();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [loaded, addEvents]);
}

function Root() {
  const { loaded } = useApp();
  const [stack, setStack] = useState<Route[]>([{ name: 'tabs' }]);
  const [tab, setTab] = useState<Tab>('dj');
  useWatcher();

  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const nav: Nav = useMemo(
    () => ({
      tab,
      setTab,
      push: (r) => setStack((s) => [...s, r]),
      replace: (r) => setStack((s) => [...s.slice(0, -1), r]),
      back,
      home: () => {
        setStack([{ name: 'tabs' }]);
        setTab('dj');
      },
    }),
    [tab, back],
  );

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        back();
        return true;
      }
      if (tab !== 'dj') {
        setTab('dj');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, tab, back]);

  if (!loaded) return <Loading />;

  const route = stack[stack.length - 1];
  let screen: React.ReactNode;
  switch (route.name) {
    case 'tabs':
      screen = (
        <>
          {tab === 'dj' ? <DjScreen /> : null}
          {tab === 'regels' ? <RulesScreen /> : null}
          {tab === 'geleerd' ? <LearnedScreen /> : null}
          {tab === 'instellingen' ? <SettingsScreen /> : null}
        </>
      );
      break;
    case 'plan':
      screen = <PlanScreen key={route.planId} planId={route.planId} />;
      break;
    case 'now':
      screen = <NowScreen />;
      break;
  }

  return (
    <NavProvider value={nav}>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <View style={{ flex: 1 }}>{screen}</View>
        {route.name !== 'now' ? <MiniPlayer overTabs={route.name === 'tabs'} /> : null}
        {route.name === 'tabs' ? <TabBar /> : null}
      </View>
    </NavProvider>
  );
}

/** Balkje onderin met wat er nu speelt, zoals in Spotify. Tik = "Nu" met de wachtrij. */
function MiniPlayer({ overTabs }: { overTabs: boolean }) {
  const nav = useNav();
  const { job } = useJob();
  const insets = useSafeAreaInsets();
  const [pb, setPb] = useState<sp.Playback | null>(null);
  const { tab } = nav;

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!(await sp.isConnected())) return;
      const p = await sp.playback().catch(() => null);
      if (alive) setPb(p);
    };
    load();
    const timer = setInterval(() => {
      if (RNAppState.currentState === 'active') load();
    }, 15_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [tab]);

  const running = job?.kind === 'queue';
  if (!pb?.item && !running) return null;
  const pct = pb?.item?.durationMs ? (100 * (pb.progressMs + (Date.now() - pb.at) * (pb.isPlaying ? 1 : 0))) / pb.item.durationMs : 0;
  return (
    <Pressable
      onPress={() => nav.push({ name: 'now' })}
      style={{ marginHorizontal: 8, marginBottom: overTabs ? 4 : insets.bottom + 8, borderRadius: 8, backgroundColor: '#2B2B2B', overflow: 'hidden' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 8, gap: 10 }}>
        <Cover uri={pb?.item?.image} size={40} />
        <View style={{ flex: 1 }}>
          <T size={14} weight="semibold" numberOfLines={1}>
            {running ? job?.status : pb?.item?.name}
          </T>
          <T size={12} color={running ? C.accent : C.muted} numberOfLines={1}>
            {running ? 'Bezig met je wachtrij' : `${pb?.item?.artists.join(', ')}${pb?.device ? ` · ${pb.device.name}` : ''}`}
          </T>
        </View>
        {running ? <ActivityIndicator color={C.accent} /> : <Icon name={pb?.isPlaying ? 'pause' : 'play'} size={22} color={C.ink} />}
      </View>
      <View style={{ height: 2, backgroundColor: '#535353', marginHorizontal: 8 }}>
        <View style={{ height: 2, width: `${Math.min(100, pct)}%`, backgroundColor: C.ink }} />
      </View>
    </Pressable>
  );
}

function TabBar() {
  const { tab, setTab } = useNav();
  const { signals, state } = useApp();
  const insets = useSafeAreaInsets();
  const questions = signals.suspicions.filter((s) => !state.learned.asked[s.id]).length;
  const item = (t: Tab, icon: IconName, label: string, badge = 0) => {
    const on = tab === t;
    return (
      <Pressable
        key={t}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        onPress={() => setTab(t)}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 54 }}
      >
        <View>
          <Icon name={icon} size={24} color={on ? C.ink : C.muted} strokeWidth={on ? 2.4 : 2} />
          {badge ? (
            <View style={{ position: 'absolute', top: -4, right: -8, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
              <Text style={{ fontFamily: F.bold, fontSize: 10, color: C.onAccent }}>{badge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={{ fontFamily: on ? F.bold : F.semibold, fontSize: 11, color: on ? C.ink : C.muted }}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={{ flexDirection: 'row', paddingTop: 6, paddingBottom: 6 + insets.bottom, backgroundColor: '#000000E6' }}>
      {item('dj', 'dj', 'DJ')}
      {item('regels', 'rules', 'Regels')}
      {item('geleerd', 'learned', 'Geleerd', questions)}
      {item('instellingen', 'settings', 'Instellingen')}
    </View>
  );
}
