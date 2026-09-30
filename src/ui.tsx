import React, { useState } from 'react';
import { Dimensions, Modal, Pressable, ScrollView, StyleProp, Text, TextInput, TextStyle, View, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F } from './theme';
import { Icon, IconName } from './icons';

// ---------- tekst ----------

export function T({
  children,
  style,
  size = 15,
  weight = 'regular',
  color = C.ink,
  numberOfLines,
  selectable,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  size?: number;
  weight?: 'regular' | 'semibold' | 'bold' | 'black';
  color?: string;
  numberOfLines?: number;
  selectable?: boolean;
}) {
  return (
    <Text numberOfLines={numberOfLines} selectable={selectable} style={[{ fontFamily: F[weight], fontSize: size, color }, style]}>
      {children}
    </Text>
  );
}

export function H1({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={[{ fontFamily: F.black, fontSize: 28, color: C.ink, letterSpacing: -0.5 }, style]}>{children}</Text>
  );
}

export function H2({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[{ fontFamily: F.bold, fontSize: 20, color: C.ink, letterSpacing: -0.2 }, style]}>{children}</Text>;
}

// ---------- layout ----------

/** Scrollend scherm; laat onderaan ruimte voor de minispeler en de tabbalk. */
export function Screen({ children, bottom = 28, gap = 18 }: { children: React.ReactNode; bottom?: number; gap?: number }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 14, paddingHorizontal: 16, paddingBottom: bottom + insets.bottom, gap }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ backgroundColor: C.card, borderRadius: 10, padding: 16, gap: 10 }, style]}>{children}</View>;
}

export function Section({ title, right, children }: { title: string; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <H2 style={{ fontSize: 18 }}>{title}</H2>
        {right}
      </Row>
      {children}
    </View>
  );
}

// ---------- knoppen ----------

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  small,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'outline' | 'ghost' | 'danger' | 'dark';
  icon?: IconName;
  disabled?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = variant === 'primary' ? C.accent : variant === 'dark' ? C.cardHi : 'transparent';
  const fg = variant === 'primary' ? C.onAccent : variant === 'danger' ? C.warn : C.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        {
          height: small ? 36 : 50,
          paddingHorizontal: small ? 16 : 28,
          borderRadius: 999,
          backgroundColor: pressed && variant === 'primary' ? C.accentDark : bg,
          borderWidth: variant === 'outline' || variant === 'danger' ? 1 : 0,
          borderColor: variant === 'danger' ? C.warn : '#7C7C7C',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={small ? 16 : 20} color={fg} strokeWidth={2.4} /> : null}
      <Text style={{ fontFamily: F.bold, fontSize: small ? 14 : 16, color: fg }}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  color = C.muted,
  bg = 'transparent',
  size = 40,
  iconSize = 22,
  fill,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  color?: string;
  bg?: string;
  size?: number;
  iconSize?: number;
  fill?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={iconSize} color={color} fill={fill} />
    </Pressable>
  );
}

/** Filterchip zoals in Spotify: grijs, geselecteerd groen. */
export function Chip({ label, on, onPress, icon }: { label: string; on?: boolean; onPress: () => void; icon?: IconName }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      onPress={onPress}
      style={({ pressed }) => ({
        // Minimale hoogte met ruimte boven en onder: lange vibes lopen over twee regels zonder de rand te raken.
        minHeight: 40,
        paddingVertical: 10,
        paddingHorizontal: 18,
        maxWidth: Dimensions.get('window').width - 40,
        borderRadius: 999,
        backgroundColor: on ? C.accent : C.cardHi,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      {icon ? <Icon name={icon} size={15} color={on ? C.onAccent : C.ink} strokeWidth={2.4} /> : null}
      <Text style={{ fontFamily: F.semibold, fontSize: 14, lineHeight: 19, color: on ? C.onAccent : C.ink, flexShrink: 1 }}>{label}</Text>
    </Pressable>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      onPress={() => onChange(!on)}
      style={{ width: 46, height: 28, borderRadius: 14, backgroundColor: on ? C.accent : '#535353', padding: 3, alignItems: on ? 'flex-end' : 'flex-start' }}
    >
      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: on ? C.onAccent : C.ink }} />
    </Pressable>
  );
}

// ---------- invoer ----------

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secure,
  onSubmit,
  multiline,
  style,
}: {
  label?: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  secure?: boolean;
  onSubmit?: () => void;
  multiline?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <T size={13} weight="semibold" color={C.muted}>{label}</T> : null}
      <TextInput
        accessibilityLabel={label ?? placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.dim}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={onSubmit}
        multiline={multiline}
        style={{
          minHeight: 46,
          borderRadius: 6,
          backgroundColor: C.cardHi,
          color: C.ink,
          fontFamily: F.regular,
          fontSize: 15,
          paddingHorizontal: 12,
          paddingVertical: multiline ? 10 : 0,
          textAlignVertical: multiline ? 'top' : 'center',
        }}
      />
    </View>
  );
}

// ---------- muziek ----------

export function Cover({ uri, size = 48, radius = 4 }: { uri?: string; size?: number; radius?: number }) {
  if (!uri) {
    return (
      <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: C.cardHi, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="music" size={size * 0.45} color={C.dim} />
      </View>
    );
  }
  return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius, backgroundColor: C.cardHi }} contentFit="cover" />;
}

export function Badge({ label, color = C.accent }: { label: string; color?: string }) {
  return (
    <View style={{ paddingHorizontal: 6, height: 18, borderRadius: 3, backgroundColor: color, justifyContent: 'center' }}>
      <Text style={{ fontFamily: F.bold, fontSize: 10, color: C.onAccent, letterSpacing: 0.3 }}>{label}</Text>
    </View>
  );
}

export function TrackRow({
  title,
  artist,
  image,
  index,
  isNew,
  right,
  dimmed,
  highlight,
}: {
  title: string;
  artist: string;
  image?: string;
  index?: number;
  isNew?: boolean;
  right?: React.ReactNode;
  dimmed?: boolean;
  highlight?: boolean; // net toegevoegd bij bijsturen
}) {
  return (
    <Row
      style={{
        gap: 12,
        minHeight: 56,
        opacity: dimmed ? 0.5 : 1,
        backgroundColor: highlight ? C.accentTint : 'transparent',
        borderRadius: highlight ? 6 : 0,
        marginHorizontal: highlight ? -6 : 0,
        paddingHorizontal: highlight ? 6 : 0,
      }}
    >
      {index != null ? (
        <T size={14} color={C.muted} style={{ width: 22, textAlign: 'right' }}>
          {index}
        </T>
      ) : null}
      <Cover uri={image} size={48} />
      <View style={{ flex: 1, gap: 3 }}>
        <T size={16} weight="semibold" numberOfLines={1}>
          {title}
        </T>
        <Row style={{ gap: 6 }}>
          {isNew ? <Badge label="NIEUW" /> : null}
          <T size={13} color={C.muted} numberOfLines={1} style={{ flex: 1 }}>
            {artist}
          </T>
        </Row>
      </View>
      {right}
    </Row>
  );
}

// ---------- meldingen ----------

export function Banner({
  level,
  text,
  action,
}: {
  level: 'ok' | 'info' | 'let op' | 'storing';
  text: string;
  action?: { label: string; onPress: () => void };
}) {
  const color = level === 'storing' ? C.warn : level === 'let op' ? C.amber : level === 'ok' ? C.accent : C.muted;
  const bg = level === 'storing' ? C.warnTint : level === 'let op' ? C.amberTint : level === 'ok' ? C.accentTint : C.card;
  return (
    <Row style={{ backgroundColor: bg, borderRadius: 8, padding: 12, gap: 10, alignItems: 'flex-start' }}>
      <Icon name={level === 'ok' ? 'check' : 'alert'} size={20} color={color} />
      <View style={{ flex: 1, gap: 8 }}>
        <T size={14} color={C.ink}>
          {text}
        </T>
        {action ? (
          <Pressable onPress={action.onPress} hitSlop={6}>
            <T size={14} weight="bold" color={color}>
              {action.label}
            </T>
          </Pressable>
        ) : null}
      </View>
    </Row>
  );
}

export function Bar({ pct, height = 4, color = C.ink }: { pct: number; height?: number; color?: string }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: '#4D4D4D', overflow: 'hidden' }}>
      <View style={{ height, width: `${w}%`, backgroundColor: color }} />
    </View>
  );
}

/** Onderblad (bottom sheet) voor keuzes. */
export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: '#000000AA' }} onPress={onClose} />
      <View style={{ backgroundColor: C.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 24 + insets.bottom, gap: 14 }}>
        <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#535353', marginBottom: 4 }} />
        {children}
      </View>
    </Modal>
  );
}

/** Lijst met tekstregels die je kunt aanvullen en weghalen. */
export function EditableList({
  items,
  onChange,
  placeholder,
  chips,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  chips?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (!items.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...items, v]);
    setDraft('');
  };
  return (
    <View style={{ gap: 10 }}>
      {chips ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {items.map((x) => (
            <Row key={x} style={{ backgroundColor: C.cardHi, borderRadius: 999, paddingLeft: 12, paddingRight: 4, height: 34, gap: 2 }}>
              <T size={14} weight="semibold">
                {x}
              </T>
              <IconButton icon="close" label={`${x} weghalen`} size={28} iconSize={14} onPress={() => onChange(items.filter((y) => y !== x))} />
            </Row>
          ))}
        </View>
      ) : (
        items.map((x, i) => (
          <Row key={`${i}-${x}`} style={{ gap: 8, alignItems: 'flex-start' }}>
            <T size={14} color={C.muted} style={{ flex: 1, lineHeight: 20 }}>
              {x}
            </T>
            <IconButton icon="trash" label="Regel weghalen" size={30} iconSize={16} onPress={() => onChange(items.filter((_, j) => j !== i))} />
          </Row>
        ))
      )}
      <Row style={{ gap: 8 }}>
        <Field value={draft} onChangeText={setDraft} placeholder={placeholder} onSubmit={add} style={{ flex: 1 }} />
        <IconButton icon="plus" label="Toevoegen" onPress={add} bg={C.cardHi} color={C.ink} size={46} />
      </Row>
    </View>
  );
}
