/**
 * Slice 2 screen: pick up to 3 creatures from the collection, choose
 * Auto or Manual, fight a generated enemy party, see the result and a
 * plain-English log. Contains NO battle rules — all resolution comes from
 * src/game/battle.ts and src/game/encounter.ts. In Manual mode this screen
 * drives the same engine one turn at a time instead of letting it run to
 * completion instantly.
 */

import React, { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { movesForCreature } from '@/src/game/content';
import {
  currentActor,
  getWinner,
  isBattleOver,
  runBattle,
  startBattle,
  takeAutoTurn,
  takeTurn,
  type BattleLogEntry,
  type BattleResult,
  type BattleState,
  type Combatant,
} from '@/src/game/battle';
import { generateEnemyParty } from '@/src/game/encounter';
import type { Creature, MoveDef, Rng } from '@/src/game/models';
import { createRng } from '@/src/game/rng';
import { CreatureCard } from '@/src/screens/CreatureCard';
import { useCollection } from '@/src/screens/CollectionContext';

const PARTY_SIZE = 3;
type Mode = 'auto' | 'manual';
type ViewPhase = 'select' | 'battling' | 'result';

function haptic() {
  if (Platform.OS !== 'web') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }
}

function formatLogEntry(entry: BattleLogEntry): string {
  const who = entry.actorSide === 'player' ? entry.actorName : `Enemy ${entry.actorName}`;
  const whom = entry.targetName === 'the party' ? 'the party' : entry.targetName;
  if (!entry.hit) {
    return `${who} used ${entry.moveName} on ${whom} — missed!`;
  }
  if (entry.moveKind === 'heal') {
    return `${who} used ${entry.moveName}, healing ${whom} for ${entry.healed}`;
  }
  const critText = entry.crit ? ' (crit!)' : '';
  const drainText = entry.moveKind === 'drain' && entry.healed > 0 ? `, healing itself for ${entry.healed}` : '';
  const faintText = entry.targetFainted ? ' — fainted!' : '';
  return `${who} used ${entry.moveName} on ${whom} for ${entry.damage} damage${critText}${drainText}${faintText}`;
}

function describeMove(move: MoveDef): string {
  if (move.kind === 'heal') {
    const pct = Math.round(move.healFraction * 100);
    return move.target === 'party' ? `Heals the whole party ${pct}%` : `Heals the lowest-HP ally ${pct}%`;
  }
  const category = move.category === 'physical' ? 'Physical' : 'Special';
  const extra = move.kind === 'drain' ? ' · drains HP' : move.kind === 'hybrid' ? ' · hybrid' : '';
  return `${category} · Power ${move.power} · ${move.accuracy}% accuracy${extra}`;
}

/** Advance the AI through every consecutive enemy turn until it's a player creature's turn, or the battle ends. */
function advanceToPlayerTurn(state: BattleState, rng: Rng): void {
  while (!isBattleOver(state) && currentActor(state)?.side === 'enemy') {
    takeAutoTurn(state, rng);
  }
}

function CombatantRow({ combatant }: { combatant: Combatant }) {
  const maxHp = combatant.creature.stats.hp;
  const pct = Math.max(0, Math.min(100, (combatant.currentHp / maxHp) * 100));
  const fainted = combatant.currentHp <= 0;
  return (
    <View style={styles.combatantRow}>
      <Text style={[styles.combatantName, fainted && styles.faintedText]} numberOfLines={1}>
        {combatant.side === 'enemy' ? 'Enemy ' : ''}
        {combatant.creature.name}
        {fainted ? ' (fainted)' : ''}
      </Text>
      <View style={styles.hpBarTrack}>
        <View style={[styles.hpBarFill, { width: `${pct}%` }, fainted && styles.hpBarFillFainted]} />
      </View>
      <Text style={styles.hpText}>
        {Math.max(0, combatant.currentHp)}/{maxHp}
      </Text>
    </View>
  );
}

export function BattleScreen() {
  const insets = useSafeAreaInsets();
  const { collection } = useCollection();

  const [mode, setMode] = useState<Mode>('auto');
  const [viewPhase, setViewPhase] = useState<ViewPhase>('select');
  const [selected, setSelected] = useState<string[]>([]);
  const [enemyParty, setEnemyParty] = useState<Creature[] | null>(null);
  const [battleState, setBattleState] = useState<BattleState | null>(null);
  const [pendingMove, setPendingMove] = useState<MoveDef | null>(null);
  const [result, setResult] = useState<BattleResult | null>(null);
  const rngRef = useRef<Rng | null>(null);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = (Platform.OS === 'web' ? 34 : insets.bottom) + 24;

  const selectedCreatures = useMemo(
    () => collection.filter((c) => selected.includes(c.id)),
    [collection, selected],
  );

  const turnActor = viewPhase === 'battling' && battleState ? currentActor(battleState) : undefined;
  const turnMoves = turnActor ? movesForCreature(turnActor.creature) : [];
  const targets = useMemo(() => {
    if (!battleState || !turnActor || !pendingMove) return [];
    if (pendingMove.kind === 'heal' && pendingMove.target === 'lowest-ally') {
      return battleState.combatants.filter((c) => c.side === turnActor.side && c.currentHp > 0);
    }
    return battleState.combatants.filter((c) => c.side !== turnActor.side && c.currentHp > 0);
  }, [battleState, turnActor, pendingMove]);

  function toggleSelect(id: string) {
    haptic();
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : prev.length < PARTY_SIZE ? [...prev, id] : prev,
    );
  }

  function finish(state: BattleState) {
    setResult({ winner: getWinner(state), log: state.log, rounds: state.round });
    setBattleState(null);
    setViewPhase('result');
  }

  function fight() {
    haptic();
    const avgTier = Math.round(
      selectedCreatures.reduce((sum, c) => sum + c.tier, 0) / selectedCreatures.length,
    );
    const rng = createRng(Date.now() % 0x7fffffff);
    const enemies = generateEnemyParty(rng, avgTier, selectedCreatures.length);
    setEnemyParty(enemies);

    if (mode === 'auto') {
      setResult(runBattle(selectedCreatures, enemies, rng));
      setViewPhase('result');
      return;
    }

    rngRef.current = rng;
    const state = startBattle(selectedCreatures, enemies);
    advanceToPlayerTurn(state, rng);
    if (isBattleOver(state)) {
      finish(state);
    } else {
      setBattleState(state);
      setViewPhase('battling');
    }
  }

  function resolvePlayerTurn(move: MoveDef, target: Combatant | undefined) {
    if (!battleState || !rngRef.current) return;
    haptic();
    takeTurn(battleState, move, target, rngRef.current);
    setPendingMove(null);
    advanceToPlayerTurn(battleState, rngRef.current);
    if (isBattleOver(battleState)) {
      finish(battleState);
    } else {
      setBattleState({ ...battleState });
    }
  }

  function pickMove(move: MoveDef) {
    haptic();
    if (move.kind === 'heal' && move.target === 'party') {
      resolvePlayerTurn(move, undefined);
      return;
    }
    setPendingMove(move);
  }

  function reset() {
    haptic();
    setResult(null);
    setBattleState(null);
    setEnemyParty(null);
    setSelected([]);
    setPendingMove(null);
    setViewPhase('select');
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: topPad + 16, paddingBottom: bottomPad, paddingHorizontal: 16, gap: 20 }}
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>Battle</Text>
        <Link href="/" style={styles.navLink}>
          Hatchery
        </Link>
      </View>

      {viewPhase === 'select' ? (
        <View style={{ gap: 12 }}>
          <View style={styles.modeRow}>
            <ModeButton label="Auto-battle" active={mode === 'auto'} onPress={() => setMode('auto')} />
            <ModeButton label="Manual" active={mode === 'manual'} onPress={() => setMode('manual')} />
          </View>
          <Text style={styles.sectionLabel}>
            Pick up to {PARTY_SIZE} creatures ({selected.length}/{PARTY_SIZE})
          </Text>
          {collection.length === 0 ? (
            <Text style={styles.mutedText}>
              No creatures yet — hatch and merge a few from the Hatchery first.
            </Text>
          ) : (
            <View style={{ gap: 10 }}>
              {collection
                .slice()
                .reverse()
                .map((c) => (
                  <Pressable key={c.id} onPress={() => toggleSelect(c.id)}>
                    <View style={selected.includes(c.id) ? styles.selectedRing : undefined}>
                      <CreatureCard creature={c} compact />
                    </View>
                  </Pressable>
                ))}
            </View>
          )}
          <PrimaryButton label="Fight" disabled={selected.length === 0} onPress={fight} />
        </View>
      ) : null}

      {viewPhase === 'battling' && battleState ? (
        <View style={{ gap: 16 }}>
          <Text style={styles.sectionLabel}>Round {battleState.round}</Text>
          <View style={{ gap: 8 }}>
            {battleState.combatants.map((c) => (
              <CombatantRow key={c.creature.id} combatant={c} />
            ))}
          </View>

          {turnActor && !pendingMove ? (
            <View style={{ gap: 8 }}>
              <Text style={styles.sectionLabel}>{turnActor.creature.name}'s turn — choose a move</Text>
              {turnMoves.map((m) => (
                <Pressable key={m.id} onPress={() => pickMove(m)} style={styles.moveButton}>
                  <Text style={styles.moveButtonText}>{m.name}</Text>
                  <Text style={styles.moveButtonSub}>{describeMove(m)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {turnActor && pendingMove ? (
            <View style={{ gap: 8 }}>
              <Text style={styles.sectionLabel}>Choose a target for {pendingMove.name}</Text>
              {targets.map((t) => (
                <Pressable
                  key={t.creature.id}
                  onPress={() => resolvePlayerTurn(pendingMove, t)}
                  style={styles.moveButton}
                >
                  <Text style={styles.moveButtonText}>
                    {t.side === 'enemy' ? 'Enemy ' : ''}
                    {t.creature.name} ({t.currentHp}/{t.creature.stats.hp} HP)
                  </Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setPendingMove(null)} style={styles.cancelButton}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={{ gap: 6 }}>
            <Text style={styles.sectionLabel}>Log so far</Text>
            <View style={styles.logBox}>
              {battleState.log.map((entry, i) => (
                <Text key={i} style={styles.logLine}>
                  {formatLogEntry(entry)}
                </Text>
              ))}
            </View>
          </View>
        </View>
      ) : null}

      {viewPhase === 'result' && result ? (
        <View style={{ gap: 16 }}>
          <View style={[styles.resultBanner, result.winner === 'player' ? styles.resultWin : styles.resultLoss]}>
            <Text style={styles.resultText}>
              {result.winner === 'player' ? 'Victory!' : 'Defeated...'}
            </Text>
            <Text style={styles.mutedText}>{result.rounds} rounds</Text>
          </View>

          <View style={{ gap: 8 }}>
            <Text style={styles.sectionLabel}>Your party</Text>
            {selectedCreatures.map((c) => (
              <CreatureCard key={c.id} creature={c} compact />
            ))}
          </View>

          <View style={{ gap: 8 }}>
            <Text style={styles.sectionLabel}>Enemy party</Text>
            {(enemyParty ?? []).map((c) => (
              <CreatureCard key={c.id} creature={c} compact />
            ))}
          </View>

          <View style={{ gap: 8 }}>
            <Text style={styles.sectionLabel}>Battle log</Text>
            <View style={styles.logBox}>
              {result.log.map((entry, i) => (
                <Text key={i} style={styles.logLine}>
                  {formatLogEntry(entry)}
                </Text>
              ))}
            </View>
          </View>

          <PrimaryButton label="New Battle" onPress={reset} />
        </View>
      ) : null}
    </ScrollView>
  );
}

function ModeButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.modeButton, active && styles.modeButtonActive]}>
      <Text style={[styles.modeButtonText, active && styles.modeButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, disabled && styles.buttonTextDisabled]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#151322',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: '#ffffff',
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
  },
  navLink: {
    color: '#7C5CFF',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  sectionLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  mutedText: {
    color: 'rgba(255,255,255,0.55)',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
  },
  selectedRing: {
    borderWidth: 2,
    borderColor: '#7C5CFF',
    borderRadius: 18,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modeButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  modeButtonActive: {
    backgroundColor: 'rgba(124,92,255,0.28)',
    borderColor: '#7C5CFF',
  },
  modeButtonText: {
    color: 'rgba(255,255,255,0.7)',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  modeButtonTextActive: {
    color: '#ffffff',
  },
  button: {
    backgroundColor: '#7C5CFF',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  buttonText: {
    color: '#ffffff',
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
  },
  buttonTextDisabled: {
    color: 'rgba(255,255,255,0.4)',
  },
  pressed: {
    opacity: 0.8,
  },
  resultBanner: {
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    gap: 4,
  },
  resultWin: {
    backgroundColor: 'rgba(76,159,112,0.28)',
  },
  resultLoss: {
    backgroundColor: 'rgba(228,87,46,0.28)',
  },
  resultText: {
    color: '#ffffff',
    fontFamily: 'Inter_700Bold',
    fontSize: 22,
  },
  logBox: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  logLine: {
    color: 'rgba(255,255,255,0.75)',
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
  },
  combatantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  combatantName: {
    color: 'rgba(255,255,255,0.85)',
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    width: 110,
  },
  faintedText: {
    color: 'rgba(255,255,255,0.35)',
  },
  hpBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  hpBarFill: {
    height: '100%',
    backgroundColor: '#4C9F70',
    borderRadius: 4,
  },
  hpBarFillFainted: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  hpText: {
    color: 'rgba(255,255,255,0.6)',
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    width: 56,
    textAlign: 'right',
  },
  moveButton: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 12,
    gap: 2,
  },
  moveButtonText: {
    color: '#ffffff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  moveButtonSub: {
    color: 'rgba(255,255,255,0.55)',
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  cancelButtonText: {
    color: 'rgba(255,255,255,0.55)',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
});
