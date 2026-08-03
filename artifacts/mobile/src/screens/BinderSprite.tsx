/**
 * Draws the Binder. Holds path geometry and nothing else.
 *
 * Every decision about what the character LOOKS like — which colours, which
 * silhouettes, which proportions — is made in src/art/binderArt.ts, where it is
 * pure and tested. This file only knows how to turn that answer into shapes.
 * Same split as CreatureSprite. If you find yourself writing an `if` about the
 * player's choices here, it belongs in the art module instead.
 *
 * Drawn shoulders-up, like a portrait: the Binder appears at 28pt in the HUD and
 * at 180pt during character creation, and a head-and-shoulders framing is the
 * only one that stays readable across that range. A full body at 28pt is mush.
 */

import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { binderArt } from '@/src/art/binderArt';
import type { Binder } from '@/src/game/models';

/** The drawing is authored against this box and scaled to whatever size is asked for. */
const VIEW_W = 100;
const VIEW_H = 110;

/** Head centre and radius, in view units. Everything else is positioned off these. */
const HEAD_CX = 50;
const HEAD_CY = 42;
const HEAD_RX = 21;
const HEAD_RY = 24;

/** Hair silhouettes. Each is drawn over the head and clipped by nothing — the
 *  shapes are authored to sit correctly on the head ellipse above. */
function hairPath(styleId: string): string | null {
  switch (styleId) {
    case 'shaved':
      return null;
    case 'crop':
      return `M${HEAD_CX - HEAD_RX} ${HEAD_CY - 2}
              C${HEAD_CX - HEAD_RX} ${HEAD_CY - HEAD_RY - 6}, ${HEAD_CX + HEAD_RX} ${HEAD_CY - HEAD_RY - 6}, ${HEAD_CX + HEAD_RX} ${HEAD_CY - 2}
              C${HEAD_CX + HEAD_RX} ${HEAD_CY - 12}, ${HEAD_CX - HEAD_RX} ${HEAD_CY - 12}, ${HEAD_CX - HEAD_RX} ${HEAD_CY - 2} Z`;
    case 'swept':
      return `M${HEAD_CX - HEAD_RX - 1} ${HEAD_CY - 4}
              C${HEAD_CX - HEAD_RX} ${HEAD_CY - HEAD_RY - 7}, ${HEAD_CX + HEAD_RX} ${HEAD_CY - HEAD_RY - 5}, ${HEAD_CX + HEAD_RX + 2} ${HEAD_CY - 6}
              C${HEAD_CX + 8} ${HEAD_CY - 18}, ${HEAD_CX - 6} ${HEAD_CY - 10}, ${HEAD_CX - HEAD_RX - 1} ${HEAD_CY - 4} Z`;
    case 'braid':
      return `M${HEAD_CX - HEAD_RX} ${HEAD_CY - 2}
              C${HEAD_CX - HEAD_RX} ${HEAD_CY - HEAD_RY - 6}, ${HEAD_CX + HEAD_RX} ${HEAD_CY - HEAD_RY - 6}, ${HEAD_CX + HEAD_RX} ${HEAD_CY - 2}
              L${HEAD_CX + HEAD_RX} ${HEAD_CY + 16}
              C${HEAD_CX + HEAD_RX - 4} ${HEAD_CY + 6}, ${HEAD_CX + HEAD_RX - 4} ${HEAD_CY - 4}, ${HEAD_CX + HEAD_RX - 6} ${HEAD_CY - 8}
              L${HEAD_CX - HEAD_RX + 6} ${HEAD_CY - 8}
              C${HEAD_CX - HEAD_RX + 4} ${HEAD_CY - 4}, ${HEAD_CX - HEAD_RX + 4} ${HEAD_CY + 6}, ${HEAD_CX - HEAD_RX} ${HEAD_CY + 16} Z`;
    case 'long':
      return `M${HEAD_CX - HEAD_RX - 2} ${HEAD_CY + 26}
              C${HEAD_CX - HEAD_RX - 3} ${HEAD_CY - HEAD_RY - 4}, ${HEAD_CX + HEAD_RX + 3} ${HEAD_CY - HEAD_RY - 4}, ${HEAD_CX + HEAD_RX + 2} ${HEAD_CY + 26}
              L${HEAD_CX + HEAD_RX - 3} ${HEAD_CY + 24}
              C${HEAD_CX + HEAD_RX - 2} ${HEAD_CY - 6}, ${HEAD_CX + HEAD_RX - 6} ${HEAD_CY - 10}, ${HEAD_CX} ${HEAD_CY - 11}
              C${HEAD_CX - HEAD_RX + 6} ${HEAD_CY - 10}, ${HEAD_CX - HEAD_RX + 2} ${HEAD_CY - 6}, ${HEAD_CX - HEAD_RX + 3} ${HEAD_CY + 24} Z`;
    case 'tied':
      return `M${HEAD_CX - HEAD_RX} ${HEAD_CY - 3}
              C${HEAD_CX - HEAD_RX} ${HEAD_CY - HEAD_RY - 6}, ${HEAD_CX + HEAD_RX} ${HEAD_CY - HEAD_RY - 6}, ${HEAD_CX + HEAD_RX} ${HEAD_CY - 3}
              C${HEAD_CX + HEAD_RX + 7} ${HEAD_CY + 2}, ${HEAD_CX + HEAD_RX + 8} ${HEAD_CY + 18}, ${HEAD_CX + HEAD_RX + 1} ${HEAD_CY + 20}
              C${HEAD_CX + HEAD_RX + 4} ${HEAD_CY + 8}, ${HEAD_CX + HEAD_RX + 1} ${HEAD_CY - 2}, ${HEAD_CX + HEAD_RX - 5} ${HEAD_CY - 9}
              L${HEAD_CX - HEAD_RX + 5} ${HEAD_CY - 9}
              C${HEAD_CX - HEAD_RX + 1} ${HEAD_CY - 6}, ${HEAD_CX - HEAD_RX} ${HEAD_CY - 4}, ${HEAD_CX - HEAD_RX} ${HEAD_CY - 3} Z`;
    default:
      return hairPath('crop');
  }
}

/** The outfit's collar/shoulder line. Drawn from the shoulder box outward. */
function outfitPath(outfitId: string, halfWidth: number, top: number): string {
  const l = HEAD_CX - halfWidth;
  const r = HEAD_CX + halfWidth;
  switch (outfitId) {
    case 'coat':
      // Squared, structured shoulders with a centre opening.
      return `M${l} ${VIEW_H} L${l} ${top + 6} L${l + 8} ${top} L${r - 8} ${top} L${r} ${top + 6} L${r} ${VIEW_H} Z`;
    case 'harness':
      // Narrower, with the shoulders left bare.
      return `M${l + 10} ${VIEW_H} L${l + 12} ${top + 8} C${HEAD_CX - 6} ${top}, ${HEAD_CX + 6} ${top}, ${r - 12} ${top + 8} L${r - 10} ${VIEW_H} Z`;
    case 'robes':
      // Wide and soft, falling outward.
      return `M${l - 6} ${VIEW_H} C${l - 2} ${top + 14}, ${l + 8} ${top + 2}, ${HEAD_CX} ${top + 2}
              C${r - 8} ${top + 2}, ${r + 2} ${top + 14}, ${r + 6} ${VIEW_H} Z`;
    case 'wrap':
    default:
      // Rounded, plain — the default.
      return `M${l} ${VIEW_H} C${l} ${top + 8}, ${HEAD_CX - 14} ${top}, ${HEAD_CX} ${top}
              C${HEAD_CX + 14} ${top}, ${r} ${top + 8}, ${r} ${VIEW_H} Z`;
  }
}

function Mark({ markId, colour }: { markId: string; colour: string }) {
  switch (markId) {
    case 'sigil':
      return (
        <Path
          d={`M${HEAD_CX + 10} ${HEAD_CY - 6} l4 -5 l4 5 l-4 5 Z`}
          fill={colour}
          opacity={0.9}
        />
      );
    case 'band':
      return (
        <Rect
          x={HEAD_CX - HEAD_RX}
          y={HEAD_CY - 9}
          width={HEAD_RX * 2}
          height={3.5}
          fill={colour}
          opacity={0.92}
        />
      );
    case 'scatter':
      return (
        <G opacity={0.85}>
          <Circle cx={HEAD_CX - 9} cy={HEAD_CY + 4} r={1.5} fill={colour} />
          <Circle cx={HEAD_CX - 4} cy={HEAD_CY + 7} r={1.1} fill={colour} />
          <Circle cx={HEAD_CX + 8} cy={HEAD_CY + 5} r={1.4} fill={colour} />
          <Circle cx={HEAD_CX + 12} cy={HEAD_CY + 1} r={1} fill={colour} />
        </G>
      );
    case 'none':
    default:
      return null;
  }
}

export function BinderSprite({ binder, size = 96 }: { binder: Binder; size?: number }) {
  const art = binderArt(binder);
  const { palette, proportions } = art;

  // Gradient ids are document-global in SVG, so two Binders on one screen would
  // fight over one definition. Namespacing by the appearance keeps them apart.
  // Same rule CreatureSprite follows for creature gradients.
  const uid = `binder-${art.outfitId}-${art.hairStyleId}-${palette.accent.replace('#', '')}`;

  const halfWidth = 30 * proportions.shoulderScale;
  const shoulderTop = 68;
  const hair = hairPath(art.hairStyleId);

  return (
    <View style={{ width: size, height: size * (VIEW_H / VIEW_W) }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
        <Defs>
          <LinearGradient id={`${uid}-outfit`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={palette.outfitLight} />
            <Stop offset="0.55" stopColor={palette.outfit} />
            <Stop offset="1" stopColor={palette.outfitShade} />
          </LinearGradient>
          <LinearGradient id={`${uid}-skin`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={palette.skin} />
            <Stop offset="1" stopColor={palette.skinShade} />
          </LinearGradient>
        </Defs>

        {/* heightScale lifts or lowers the whole figure about its base, so a
            "tall" build reads as taller rather than merely bigger. */}
        <G
          transform={`translate(0 ${VIEW_H * (1 - proportions.heightScale)}) scale(1 ${proportions.heightScale})`}
        >
          {/* Neck, drawn first so the outfit and jaw overlap it. */}
          <Rect x={HEAD_CX - 7} y={HEAD_CY + 12} width={14} height={18} fill={palette.skinShade} />

          <Path
            d={outfitPath(art.outfitId, halfWidth, shoulderTop)}
            fill={`url(#${uid}-outfit)`}
            stroke={palette.outline}
            strokeWidth={1.4}
          />

          {/* Accent trim along the collar — the one place the Binder wears their
              chosen element, which is what ties them to the creature they made. */}
          <Path
            d={`M${HEAD_CX - halfWidth + 4} ${shoulderTop + 9} C${HEAD_CX - 10} ${shoulderTop + 2}, ${HEAD_CX + 10} ${shoulderTop + 2}, ${HEAD_CX + halfWidth - 4} ${shoulderTop + 9}`}
            stroke={palette.accent}
            strokeWidth={2.6}
            fill="none"
            strokeLinecap="round"
          />

          {hair ? <Path d={hair} fill={palette.hairShade} /> : null}

          <Ellipse
            cx={HEAD_CX}
            cy={HEAD_CY}
            rx={HEAD_RX}
            ry={HEAD_RY}
            fill={`url(#${uid}-skin)`}
            stroke={palette.outline}
            strokeWidth={1.2}
          />

          {/* Fringe sits over the face; the back of the hair sat behind it. */}
          {hair ? <Path d={hair} fill={palette.hair} opacity={0.94} /> : null}

          <Circle cx={HEAD_CX - 7.5} cy={HEAD_CY + 2} r={2.1} fill={palette.eye} />
          <Circle cx={HEAD_CX + 7.5} cy={HEAD_CY + 2} r={2.1} fill={palette.eye} />

          <Mark markId={art.markId} colour={palette.accent} />
        </G>
      </Svg>
    </View>
  );
}
