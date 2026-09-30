declare module 'react' {
  export type ReactNode = any;
  export type Dispatch<A> = (a: A) => void;
  export type SetStateAction<S> = S | ((p: S) => S);
  export function useState<S>(v: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useMemo<T>(f: () => T, deps: any[]): T;
  export function useCallback<T extends (...a: any[]) => any>(f: T, deps: any[]): T;
  export function useEffect(f: () => any, deps?: any[]): void;
  export function useRef<T>(v: T): { current: T };
  export function useContext<T>(c: Context<T>): T;
  export interface Context<T> { Provider: any }
  export function createContext<T>(v: T): Context<T>;
  const React: any;
  export default React;
}
declare module 'react/jsx-runtime' { export const jsx: any; export const jsxs: any; export const Fragment: any; }
declare namespace JSX { interface IntrinsicElements { [k: string]: any } interface Element {} interface ElementChildrenAttribute { children: {} } }
declare module 'react-native' {
  export const View: any, Text: any, Pressable: any, ScrollView: any, TextInput: any, ActivityIndicator: any, BackHandler: any;
  export const StyleSheet: { create<T>(s: T): T; absoluteFill: any };
  export function useWindowDimensions(): { width: number; height: number };
  export const Dimensions: { get(w: 'window' | 'screen'): { width: number; height: number } };
  export type StyleProp<T> = any; export type ViewStyle = any; export type TextStyle = any; export type KeyboardTypeOptions = string;
}
declare module 'react-native-svg' { const Svg: any; export default Svg; export const Circle: any, Path: any, Line: any, Text: any, Rect: any; }
declare module 'react-native-safe-area-context' { export const SafeAreaProvider: any; export function useSafeAreaInsets(): { top: number; bottom: number; left: number; right: number }; }
declare module 'expo-status-bar' { export const StatusBar: any; }
declare module 'expo-font' { export function useFonts(m: any): [boolean, Error | null]; }
declare module 'expo' { export function registerRootComponent(c: any): void; }
declare module 'expo-camera' { export const CameraView: any; export function useCameraPermissions(): [{ granted: boolean } | null, () => Promise<any>]; }
declare module '@expo-google-fonts/bricolage-grotesque' { export const BricolageGrotesque_700Bold: any; }
declare module '@expo-google-fonts/figtree' { export const Figtree_400Regular: any, Figtree_600SemiBold: any, Figtree_700Bold: any, Figtree_800ExtraBold: any; }
declare module '@react-native-async-storage/async-storage' { const A: { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void> }; export default A; }
declare namespace React { type ReactNode = any; }
declare namespace JSX { interface IntrinsicAttributes { key?: any } }
declare module 'expo-clipboard' { export function getStringAsync(): Promise<string>; }
declare module '@react-native-community/datetimepicker' { export const DateTimePickerAndroid: { open(o: { value: Date; mode: 'date' | 'time'; maximumDate?: Date; onChange: (event: { type: string }, date?: Date) => void }): void }; }
declare module 'expo-image-manipulator' { const x: any; export = x; }
declare module '@zxing/library' { const x: any; export = x; }
declare module 'jpeg-js' { const x: any; export = x; }
declare module 'expo-modules-core' { export function requireOptionalNativeModule<T = any>(name: string): T | null; }
declare module 'react-native' {
  export const Modal: any, Linking: { openURL(u: string): Promise<void> }, PermissionsAndroid: { request(p: any): Promise<any> };
  export const AppState: { currentState: string; addEventListener(e: string, f: (s: string) => void): { remove(): void } };
  export const Platform: { OS: string; Version: number | string };
}
declare module 'expo-image' { export const Image: any; }
declare module 'expo-secure-store' { export function getItemAsync(k: string): Promise<string | null>; export function setItemAsync(k: string, v: string): Promise<void>; export function deleteItemAsync(k: string): Promise<void>; }
declare module 'expo-web-browser' { export function maybeCompleteAuthSession(): void; }
declare module 'expo-auth-session' {
  export enum ResponseType { Code = 'code' }
  export class AuthRequest { constructor(o: any); codeVerifier?: string; promptAsync(d: any): Promise<{ type: string; params: Record<string, string> }>; }
  export function exchangeCodeAsync(o: any, d: any): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }>;
}
declare module 'expo-clipboard' { export function setStringAsync(s: string): Promise<boolean>; }
declare module 'expo-constants' { const C: { expoConfig?: { version?: string } | null }; export default C; }
declare module 'spotify-watcher' {
  export const available: boolean;
  export function isRunning(): boolean; export function lastEventAt(): number; export function start(): Promise<boolean>; export function stop(): Promise<boolean>;
  export function readAndClear(): Promise<string>; export function listen(p: string, h?: string[]): Promise<string[]>; export function openBatterySettings(): Promise<boolean>; export function openSpotify(): Promise<boolean>;
  export function authSet(c: string, r: string, a: string, e: number): Promise<void>; export function authClear(): Promise<void>; export function hasAuth(): boolean; export function accessToken(force?: boolean): Promise<string>;
  export type LiveCandidate = { id: string; artists: string[]; isNew: boolean; style: string; durationMs: number; key?: string };
  export type NativeLiveState = { active: boolean; queuedId: string; history: { id: string; outcome: 'full' | 'skip'; listenedMs: number; at: number }[]; served?: string[]; error: string };
  export function liveStart(q: string, c: LiveCandidate[], m?: LiveCandidate): Promise<boolean>; export function liveSetCandidates(c: LiveCandidate[]): Promise<void>;
  export function liveSetQueued(id: string, m: LiveCandidate | null): Promise<void>; export function liveStop(): Promise<void>; export function liveState(): Promise<NativeLiveState | null>;
}
