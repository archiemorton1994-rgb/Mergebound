/**
 * Collection state + persistence. This is the only place that talks to
 * AsyncStorage. All serialisation rules live in src/game/save.ts —
 * this file just stores and retrieves the string.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Creature } from '@/src/game/models';
import { deserializeCollection, serializeCollection } from '@/src/game/save';

const STORAGE_KEY = 'creature-merge:collection:v1';

interface CollectionContextValue {
  collection: Creature[];
  /** Merges since the last natural (or pity-forced) perfect stat roll — see merge.ts's mergeWithPity. */
  mergePity: number;
  loading: boolean;
  loadError: string | null;
  addCreatures: (creatures: Creature[]) => void;
  /** Remove the two parents and add the merge result in one atomic update. */
  applyMerge: (parentAId: string, parentBId: string, result: Creature) => void;
  setMergePity: (value: number) => void;
}

const CollectionContext = createContext<CollectionContextValue | null>(null);

export function CollectionProvider({ children }: { children: React.ReactNode }) {
  const [collection, setCollection] = useState<Creature[]>([]);
  const [mergePity, setMergePity] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw !== null) {
          const data = deserializeCollection(raw);
          setCollection(data.collection);
          setMergePity(data.mergePity);
        }
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
    AsyncStorage.setItem(STORAGE_KEY, serializeCollection({ collection, mergePity })).catch(() => {
      // Storage write failures are surfaced on next load; nothing to do here.
    });
  }, [collection, mergePity]);

  const addCreatures = useCallback((creatures: Creature[]) => {
    setCollection((prev) => [...prev, ...creatures]);
  }, []);

  const applyMerge = useCallback(
    (parentAId: string, parentBId: string, result: Creature) => {
      setCollection((prev) => [
        ...prev.filter((c) => c.id !== parentAId && c.id !== parentBId),
        result,
      ]);
    },
    [],
  );

  return (
    <CollectionContext.Provider
      value={{ collection, mergePity, loading, loadError, addCreatures, applyMerge, setMergePity }}
    >
      {children}
    </CollectionContext.Provider>
  );
}

export function useCollection(): CollectionContextValue {
  const ctx = useContext(CollectionContext);
  if (!ctx) throw new Error('useCollection must be used inside CollectionProvider');
  return ctx;
}
