import React, { useState } from 'react';
import { View } from 'react-native';
import { useApp } from '../store';
import { C } from '../theme';
import { Button, Card, EditableList, Field, H1, IconButton, Row, Screen, Section, T } from '../ui';
import { DEFAULT_RULES } from '../logic/rules';
import type { Rules } from '../logic/types';

/** Je regels, blocklist en favorieten: alles zelf te bekijken en aan te passen. */
export function RulesScreen() {
  const { state, update } = useApp();
  const r = state.rules;
  const set = (patch: Partial<Rules>) => update((s) => ({ ...s, rules: { ...s.rules, ...patch } }));
  const [favTitle, setFavTitle] = useState(r.eurovisionFavorite.title);
  const [favArtist, setFavArtist] = useState(r.eurovisionFavorite.artist);
  const [pc, setPc] = useState(r.pcDevice);

  return (
    <Screen>
      <H1>Regels</H1>
      <T color={C.muted} size={14}>
        Claude houdt zich hieraan, en de app controleert de harde regels zelf nog een keer.
      </T>

      <Section title="Blocklist">
        <T size={13} color={C.muted}>
          Artiesten die nooit langskomen, ook niet als gastartiest.
        </T>
        <EditableList chips items={r.blockedArtists} onChange={(blockedArtists) => set({ blockedArtists })} placeholder="Artiest toevoegen" />
      </Section>

      <Section title="Worship alleen op verzoek">
        <T size={13} color={C.muted}>
          Deze artiesten (en worship/christelijke muziek in het algemeen) komen alleen als je erom vraagt, bv. "worship" of "zondag met Brandon Lake".
        </T>
        <EditableList chips items={r.worshipArtists} onChange={(worshipArtists) => set({ worshipArtists })} placeholder="Artiest toevoegen" />
      </Section>

      <Section title="Eurovisie-favoriet">
        <T size={13} color={C.muted}>
          Zit altijd in een Eurovisie-wachtrij.
        </T>
        <Card>
          <Field label="Titel" value={favTitle} onChangeText={setFavTitle} />
          <Field label="Artiest" value={favArtist} onChangeText={setFavArtist} />
          <Button
            label="Opslaan"
            small
            variant="dark"
            style={{ alignSelf: 'flex-start' }}
            disabled={!favTitle.trim() || !favArtist.trim()}
            onPress={() => {
              set({ eurovisionFavorite: { title: favTitle.trim(), artist: favArtist.trim() } });
              update((s) => ({ ...s, favorite: null }));
            }}
          />
        </Card>
      </Section>

      <Section title="Mijn regels">
        <T size={13} color={C.muted}>
          Gaan letterlijk mee naar Claude.
        </T>
        <EditableList items={r.customRules} onChange={(customRules) => set({ customRules })} placeholder="Nieuwe regel" />
      </Section>

      <Section title="Mijn smaak">
        <T size={13} color={C.muted}>
          Startpunt voor Claude; de app leert daarnaast zelf van wat je luistert en skipt.
        </T>
        <EditableList items={r.taste} onChange={(taste) => set({ taste })} placeholder="Bv. Gym: NF, Imagine Dragons" />
      </Section>

      <Section title="Snelle knoppen">
        <EditableList chips items={r.quickVibes} onChange={(quickVibes) => set({ quickVibes })} placeholder="Knop toevoegen" />
      </Section>

      <Section title="Wachtrij">
        <Card>
          <Stepper label="Aantal nummers" value={r.count} min={10} max={40} onChange={(count) => set({ count })} />
          <Stepper label="1 nieuw nummer per … bekende" value={r.newEvery} min={2} max={8} onChange={(newEvery) => set({ newEvery })} />
        </Card>
      </Section>

      <Section title="Apparaten">
        <T size={13} color={C.muted}>
          De app speelt altijd af op het apparaat dat al actief is en zet nooit uit zichzelf over. Is er niets actief, dan je pc.
        </T>
        <Card>
          <Field label="Naam van je pc in Spotify" value={pc} onChangeText={setPc} onSubmit={() => set({ pcDevice: pc.trim() || DEFAULT_RULES.pcDevice })} />
          <Button label="Opslaan" small variant="dark" style={{ alignSelf: 'flex-start' }} onPress={() => set({ pcDevice: pc.trim() || DEFAULT_RULES.pcDevice })} />
          <T size={13} weight="semibold" color={C.muted}>
            Nooit uit zichzelf naar:
          </T>
          <EditableList chips items={r.neverDevices} onChange={(neverDevices) => set({ neverDevices })} placeholder="Apparaat" />
        </Card>
      </Section>

      <Button
        label="Standaardregels terugzetten"
        variant="outline"
        small
        style={{ alignSelf: 'flex-start' }}
        onPress={() => {
          update((s) => ({ ...s, rules: DEFAULT_RULES, favorite: null }));
          setFavTitle(DEFAULT_RULES.eurovisionFavorite.title);
          setFavArtist(DEFAULT_RULES.eurovisionFavorite.artist);
          setPc(DEFAULT_RULES.pcDevice);
        }}
      />
    </Screen>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <T style={{ flex: 1 }}>{label}</T>
      <Row style={{ gap: 4 }}>
        <IconButton icon="minus" label="Minder" onPress={() => onChange(Math.max(min, value - 1))} iconSize={16} bg={C.cardHi} color={C.ink} size={34} />
        <View style={{ width: 36, alignItems: 'center' }}>
          <T weight="bold" size={16}>
            {value}
          </T>
        </View>
        <IconButton icon="plus" label="Meer" onPress={() => onChange(Math.min(max, value + 1))} iconSize={16} bg={C.cardHi} color={C.ink} size={34} />
      </Row>
    </Row>
  );
}
