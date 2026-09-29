import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'dj'
  | 'rules'
  | 'learned'
  | 'settings'
  | 'mic'
  | 'send'
  | 'swap'
  | 'play'
  | 'pause'
  | 'check'
  | 'close'
  | 'back'
  | 'chevron'
  | 'queue'
  | 'spark'
  | 'alert'
  | 'refresh'
  | 'device'
  | 'plus'
  | 'minus'
  | 'trash'
  | 'moon'
  | 'music';

type Props = { name: IconName; size?: number; color: string; fill?: string; strokeWidth?: number };

export function Icon({ name, size = 24, color, fill = 'none', strokeWidth = 2 }: Props) {
  const c = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  let body: React.ReactNode;
  switch (name) {
    case 'dj': // draaitafel
      body = (
        <>
          <Circle {...c} cx={12} cy={12} r={9} />
          <Circle {...c} cx={12} cy={12} r={3} />
          <Path {...c} d="M12 3a9 9 0 0 1 9 9" />
        </>
      );
      break;
    case 'rules':
      body = <Path {...c} d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4" />;
      break;
    case 'learned':
      body = (
        <>
          <Path {...c} d="M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3z" />
          <Path {...c} d="M9.5 21h5" />
        </>
      );
      break;
    case 'settings':
      body = (
        <>
          <Circle {...c} cx={12} cy={12} r={3} />
          <Path {...c} d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </>
      );
      break;
    case 'mic':
      body = (
        <>
          <Rect {...c} x={9} y={3} width={6} height={11} rx={3} />
          <Path {...c} d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </>
      );
      break;
    case 'send':
      body = <Path {...c} d="M5 12h14M13 6l6 6-6 6" />;
      break;
    case 'swap':
      body = <Path {...c} d="M17 3l4 4-4 4M21 7H8a4 4 0 0 0-4 4M7 21l-4-4 4-4M3 17h13a4 4 0 0 0 4-4" />;
      break;
    case 'play':
      body = <Path {...c} fill={fill === 'none' ? color : fill} d="M7 4.5v15l12-7.5z" />;
      break;
    case 'pause':
      body = <Path {...c} d="M8 5v14M16 5v14" />;
      break;
    case 'check':
      body = <Path {...c} d="M4.5 12.5l5 5 10-11" />;
      break;
    case 'close':
      body = <Path {...c} d="M18 6 6 18M6 6l12 12" />;
      break;
    case 'back':
      body = <Path {...c} d="m15 18-6-6 6-6" />;
      break;
    case 'chevron':
      body = <Path {...c} d="m9 18 6-6-6-6" />;
      break;
    case 'queue':
      body = <Path {...c} d="M4 6h16M4 12h10M4 18h10M17 14v7l4-3.5z" />;
      break;
    case 'spark':
      body = <Path {...c} d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />;
      break;
    case 'alert':
      body = (
        <>
          <Circle {...c} cx={12} cy={12} r={9} />
          <Path {...c} d="M12 7.5v5.5M12 16.5h0" />
        </>
      );
      break;
    case 'refresh':
      body = <Path {...c} d="M20 11a8 8 0 0 0-14.9-3M4 5v4h4M4 13a8 8 0 0 0 14.9 3M20 19v-4h-4" />;
      break;
    case 'device':
      body = (
        <>
          <Rect {...c} x={7} y={2.5} width={10} height={19} rx={2} />
          <Path {...c} d="M11 18h2" />
        </>
      );
      break;
    case 'plus':
      body = <Path {...c} d="M12 5v14M5 12h14" />;
      break;
    case 'minus':
      body = <Path {...c} d="M5 12h14" />;
      break;
    case 'trash':
      body = <Path {...c} d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />;
      break;
    case 'moon':
      body = <Path {...c} d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />;
      break;
    case 'music':
      body = (
        <>
          <Path {...c} d="M9 18V5l11-2v13" />
          <Circle {...c} cx={6} cy={18} r={3} />
          <Circle {...c} cx={17} cy={16} r={3} />
        </>
      );
      break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {body}
    </Svg>
  );
}
