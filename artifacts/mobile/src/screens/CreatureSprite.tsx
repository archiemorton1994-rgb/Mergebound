/**
 * Draws a creature as vector art. What it should look like is decided in
 * src/art/creatureArt.ts (pure, tested); this file only knows how to draw.
 *
 * Everything is drawn from paths rather than image files, so any species and
 * type combination a merge produces already has art — no asset goes missing
 * when a player invents a combination nobody anticipated.
 */

import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import { creatureArt, type BodyShape } from '@/src/art/creatureArt';
import type { Creature } from '@/src/game/models';

interface Props {
  creature: Creature;
  size?: number;
}

interface Geometry {
  /** The main silhouette. */
  body: string;
  /** Optional secondary-colour detail: belly, wings, markings. */
  accent: string | null;
  /** Wings need to sit behind the body; bellies and markings sit in front. */
  accentBehind: boolean;
  /** Eye placement, mirrored either side of the centre line at x = 50. */
  eyeY: number;
  eyeDx: number;
  eyeR: number;
}

const GEOMETRY: Record<BodyShape, Geometry> = {
  flame: {
    body: 'M50 12 C58 32 78 40 78 60 C78 79 65 91 50 91 C35 91 22 79 22 60 C22 40 42 32 50 12 Z',
    accent: 'M50 44 C59 53 63 62 63 71 C63 81 57 88 50 88 C43 88 37 81 37 71 C37 62 41 53 50 44 Z',
    accentBehind: false,
    eyeY: 55,
    eyeDx: 12,
    eyeR: 5.5,
  },
  leaf: {
    body: 'M50 28 C71 28 85 43 85 61 C85 79 69 91 50 91 C31 91 15 79 15 61 C15 43 29 28 50 28 Z',
    accent: 'M50 6 C60 15 62 24 50 31 C38 24 40 15 50 6 Z',
    accentBehind: true,
    eyeY: 58,
    eyeDx: 14,
    eyeR: 6,
  },
  droplet: {
    body: 'M50 12 C50 12 81 48 81 65 C81 80 67 91 50 91 C33 91 19 80 19 65 C19 48 50 12 50 12 Z',
    accent: 'M35 67 C35 58 40 50 46 48 C43 58 42 67 45 78 C39 77 35 73 35 67 Z',
    accentBehind: false,
    eyeY: 63,
    eyeDx: 12,
    eyeR: 5.5,
  },
  wing: {
    body: 'M50 29 C63 29 71 42 71 59 C71 77 62 91 50 91 C38 91 29 77 29 59 C29 42 37 29 50 29 Z',
    accent:
      'M31 43 C15 35 5 45 8 59 C19 59 26 53 31 47 Z M69 43 C85 35 95 45 92 59 C81 59 74 53 69 47 Z',
    accentBehind: true,
    eyeY: 54,
    eyeDx: 9,
    eyeR: 5,
  },
  boulder: {
    body: 'M28 91 L15 60 L30 33 L59 25 L83 44 L87 71 L74 91 Z',
    accent: 'M37 62 L48 45 L64 52 L59 70 Z',
    accentBehind: false,
    eyeY: 55,
    eyeDx: 14,
    eyeR: 5.5,
  },
  spark: {
    body: 'M50 8 L61 33 L86 28 L69 49 L88 66 L63 69 L59 92 L44 73 L22 85 L29 61 L9 51 L33 43 L27 19 Z',
    accent: 'M50 34 C60 40 63 49 58 58 C52 65 44 63 40 56 C37 48 42 38 50 34 Z',
    accentBehind: false,
    eyeY: 50,
    eyeDx: 9,
    eyeR: 4.5,
  },
  wisp: {
    body: 'M50 13 C67 13 78 28 78 47 C78 62 76 75 81 90 C72 85 67 92 58 87 C54 93 46 93 42 87 C33 92 28 85 19 90 C24 75 22 62 22 47 C22 28 33 13 50 13 Z',
    accent: 'M50 24 C60 24 66 32 66 42 C66 50 59 56 50 56 C41 56 34 50 34 42 C34 32 40 24 50 24 Z',
    accentBehind: false,
    eyeY: 42,
    eyeDx: 11,
    eyeR: 5,
  },
  crystal: {
    body: 'M50 7 L76 39 L67 88 L33 88 L24 39 Z',
    accent: 'M50 7 L50 88 L33 88 L24 39 Z',
    accentBehind: false,
    eyeY: 52,
    eyeDx: 10,
    eyeR: 5,
  },
};

const SPARKLE_COLOR = '#ffd966';

/** Four-point star, drawn centred on the origin and positioned by transform. */
function Sparkle({ x, y, scale }: { x: number; y: number; scale: number }) {
  return (
    <Path
      d="M0 -10 C1.6 -3 3 -1.6 10 0 C3 1.6 1.6 3 0 10 C-1.6 3 -3 1.6 -10 0 C-3 -1.6 -1.6 -3 0 -10 Z"
      fill={SPARKLE_COLOR}
      transform={`translate(${x} ${y}) scale(${scale})`}
    />
  );
}

export function CreatureSprite({ creature, size = 96 }: Props) {
  const art = creatureArt(creature);
  const geometry = GEOMETRY[art.shape];
  const { palette } = art;

  // SVG gradient ids are document-global, so two sprites on the same screen
  // would otherwise share (and fight over) one definition.
  const uid = `cs${creature.id.replace(/[^a-zA-Z0-9]/g, '')}`;
  const bodyFill = `url(#${uid}body)`;
  const auraFill = `url(#${uid}aura)`;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id={`${uid}body`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={palette.bodyLight} />
            <Stop offset="1" stopColor={palette.bodyShade} />
          </LinearGradient>
          <RadialGradient id={`${uid}aura`} cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor={palette.bodyLight} stopOpacity={0} />
            <Stop offset="0.72" stopColor={palette.bodyLight} stopOpacity={art.auraLevel === 2 ? 0.55 : 0.3} />
            <Stop offset="1" stopColor={palette.bodyLight} stopOpacity={0} />
          </RadialGradient>
        </Defs>

        {art.auraLevel > 0 ? <Circle cx={50} cy={52} r={49} fill={auraFill} /> : null}

        {geometry.accentBehind && geometry.accent ? (
          <Path d={geometry.accent} fill={palette.accent} stroke={palette.outline} strokeWidth={2} strokeLinejoin="round" />
        ) : null}

        <Path
          d={geometry.body}
          fill={bodyFill}
          stroke={palette.outline}
          strokeWidth={2.5}
          strokeLinejoin="round"
        />

        {!geometry.accentBehind && geometry.accent ? (
          <Path d={geometry.accent} fill={palette.accent} opacity={0.85} />
        ) : null}

        <G>
          <Circle cx={50 - geometry.eyeDx} cy={geometry.eyeY} r={geometry.eyeR} fill="#ffffff" />
          <Circle cx={50 + geometry.eyeDx} cy={geometry.eyeY} r={geometry.eyeR} fill="#ffffff" />
          <Circle
            cx={50 - geometry.eyeDx}
            cy={geometry.eyeY + geometry.eyeR * 0.15}
            r={geometry.eyeR * 0.52}
            fill={palette.eye}
          />
          <Circle
            cx={50 + geometry.eyeDx}
            cy={geometry.eyeY + geometry.eyeR * 0.15}
            r={geometry.eyeR * 0.52}
            fill={palette.eye}
          />
        </G>

        {/* Orbiting shards mark the highest tiers without needing new silhouettes. */}
        {art.auraLevel === 2 ? (
          <G opacity={0.9}>
            <Circle cx={14} cy={30} r={4} fill={palette.accent} stroke={palette.outline} strokeWidth={1.2} />
            <Circle cx={86} cy={38} r={3.2} fill={palette.accent} stroke={palette.outline} strokeWidth={1.2} />
            <Circle cx={78} cy={16} r={2.4} fill={palette.accent} stroke={palette.outline} strokeWidth={1.2} />
          </G>
        ) : null}

        {art.sparkle ? (
          <G>
            <Sparkle x={80} y={22} scale={0.85} />
            <Sparkle x={20} y={16} scale={0.5} />
          </G>
        ) : null}
      </Svg>
    </View>
  );
}
