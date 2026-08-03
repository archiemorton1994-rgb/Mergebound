/**
 * Player state + persistence. This is the only place that talks to
 * AsyncStorage, and the only place the device clock enters the game.
 * All serialisation rules live in src/game/save.ts — this file just stores
 * and retrieves the string.
 *
 * The whole save is held as ONE piece of state on purpose. It used to be a
 * field per concern, with a persist effect listing them in its dependency
 * array — an arrangement where forgetting to add a new field to that array
 * works perfectly all session and then silently loses the data on relaunch,
 * with no error, no crash, and nothing in the test suite that would catch it.
 * With a single object there is nothing to forget.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { advanceDay } from '@/src/game/clock';
import type { Binder, Creature, OnboardingStep, Wallet } from '@/src/game/models';
import {
  deserializeCollection,
  serializeCollection,
  stampFreshSave,
  withDefaults,
  type SaveData,
} from '@/src/game/save';
import { reportedDayIndex } from '@/src/game/clock';

/** The `v1` here is part of the key's NAME, not the save version. Renaming it orphans every existing save. */
const STORAGE_KEY = 'creature-merge:collection:v1';

function emptySave(): SaveData {
  return withDefaults({ collection: [], mergePity: 0 });
}

interface CollectionContextValue {
  save: SaveData;
  /** Convenience accessors — the same data, reached the way screens want it. */
  collection: Creature[];
  mergePity: number;
  wallet: Wallet;
  binder: Binder;
  lockedIds: string[];
  loading: boolean;
  loadError: string | null;

  addCreatures: (creatures: Creature[]) => void;
  /** Remove the two parents and add the merge result in one atomic update. */
  applyMerge: (parentAId: string, parentBId: string, result: Creature) => void;
  setMergePity: (value: number) => void;
  toggleLock: (creatureId: string) => void;
  setBinder: (binder: Binder) => void;
  setOnboardingStep: (step: OnboardingStep) => void;
  /** Escape hatch for anything not covered above. Always takes the previous save. */
  updateSave: (update: (previous: SaveData) => SaveData) => void;
}

const CollectionContext = createContext<CollectionContextValue | null>(null);

export function CollectionProvider({ children }: { children: React.ReactNode }) {
  const [save, setSave] = useState<SaveData>(emptySave);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const parsed = raw !== null ? deserializeCollection(raw) : emptySave();

        // The one place the clock enters the game. Everything downstream takes
        // time as a parameter so it stays testable.
        const now = Date.now();
        const tzOffset = new Date().getTimezoneOffset();
        const stamped = stampFreshSave(parsed, now, reportedDayIndex(now, tzOffset));
        const { economy } = advanceDay(stamped.economy, now, tzOffset);

        setSave({ ...stamped, economy });
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load save data');
      } finally {
        loaded.current = true;
        setLoading(false);
      }
    })();
  }, []);

  // Persist on every change after the initial load.
  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(STORAGE_KEY, serializeCollection(save)).catch(() => {
      // Storage write failures are surfaced on next load; nothing to do here.
    });
  }, [save]);

  const updateSave = useCallback((update: (previous: SaveData) => SaveData) => {
    setSave(update);
  }, []);

  const addCreatures = useCallback((creatures: Creature[]) => {
    setSave((prev) => ({ ...prev, collection: [...prev.collection, ...creatures] }));
  }, []);

  const applyMerge = useCallback((parentAId: string, parentBId: string, result: Creature) => {
    setSave((prev) => ({
      ...prev,
      collection: [
        ...prev.collection.filter((c) => c.id !== parentAId && c.id !== parentBId),
        result,
      ],
      // A consumed parent's lock goes with it, so stale ids never accumulate.
      lockedIds: prev.lockedIds.filter((id) => id !== parentAId && id !== parentBId),
    }));
  }, []);

  const setMergePity = useCallback((value: number) => {
    setSave((prev) => ({ ...prev, mergePity: value }));
  }, []);

  const toggleLock = useCallback((creatureId: string) => {
    setSave((prev) => ({
      ...prev,
      lockedIds: prev.lockedIds.includes(creatureId)
        ? prev.lockedIds.filter((id) => id !== creatureId)
        : [...prev.lockedIds, creatureId],
    }));
  }, []);

  const setBinder = useCallback((binder: Binder) => {
    setSave((prev) => ({ ...prev, binder }));
  }, []);

  const setOnboardingStep = useCallback((step: OnboardingStep) => {
    setSave((prev) => ({ ...prev, onboarding: { ...prev.onboarding, step } }));
  }, []);

  const value = useMemo<CollectionContextValue>(
    () => ({
      save,
      collection: save.collection,
      mergePity: save.mergePity,
      wallet: save.wallet,
      binder: save.binder,
      lockedIds: save.lockedIds,
      loading,
      loadError,
      addCreatures,
      applyMerge,
      setMergePity,
      toggleLock,
      setBinder,
      setOnboardingStep,
      updateSave,
    }),
    [
      save,
      loading,
      loadError,
      addCreatures,
      applyMerge,
      setMergePity,
      toggleLock,
      setBinder,
      setOnboardingStep,
      updateSave,
    ],
  );

  return <CollectionContext.Provider value={value}>{children}</CollectionContext.Provider>;
}

export function useCollection(): CollectionContextValue {
  const ctx = useContext(CollectionContext);
  if (!ctx) throw new Error('useCollection must be used inside CollectionProvider');
  return ctx;
}
