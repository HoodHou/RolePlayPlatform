import { MODULE_IDS, type ModuleId, type ModuleLibraryEntry, type PublicSettings } from '@roleplay/shared';
import { useMemo } from 'react';
import { create } from 'zustand';
import { api } from '../api/client';
import type { LoadStatus } from './game';
import { useSettings } from './settings';

interface LibraryState {
  /** Every module as the server lists it: tools, costs, what it keeps. Null until loaded. */
  entries: ModuleLibraryEntry[] | null;
  status: LoadStatus;
  load: () => Promise<void>;
  /**
   * Subscribes to a module or unsubscribes from it, by saving the whole new
   * list of subscriptions. Throws a RequestError when the server refuses.
   */
  setSubscribed: (id: ModuleId, on: boolean) => Promise<void>;
}

/** The subscriptions in hand: from the settings when they are loaded, otherwise from the library. */
function subscriptionsOf(settings: PublicSettings | null, entries: ModuleLibraryEntry[] | null): ModuleId[] | null {
  // An older server has no list; a missing one must not crash the UI.
  const saved = settings?.subscribedModules;
  if (Array.isArray(saved)) return MODULE_IDS.filter((id) => saved.includes(id));
  if (entries) return entries.filter((entry) => entry.subscribed).map((entry) => entry.id);
  return null;
}

export const useLibrary = create<LibraryState>()((set, get) => ({
  entries: null,
  status: 'idle',

  load: async () => {
    if (get().status === 'loading') return;
    // Keep showing a list we already have while it refreshes.
    if (get().entries === null) set({ status: 'loading' });
    try {
      const { modules } = await api.getModules();
      set({ entries: modules, status: 'ready' });
    } catch {
      if (get().entries === null) set({ status: 'error' });
    }
  },

  setSubscribed: async (id, on) => {
    const current = subscriptionsOf(useSettings.getState().settings, get().entries) ?? [];
    const next = MODULE_IDS.filter((module) => (module === id ? on : current.includes(module)));
    const saved = await useSettings.getState().save({ subscribedModules: next });
    const list = Array.isArray(saved.subscribedModules) ? saved.subscribedModules : next;
    const entries = get().entries;
    if (entries) set({ entries: entries.map((entry) => ({ ...entry, subscribed: list.includes(entry.id) })) });
  },
}));

/**
 * The modules the player subscribes to, in the fixed module order. Null while
 * nothing has said yet (settings still loading or failed, library not loaded).
 */
export function useSubscriptions(): ModuleId[] | null {
  const settings = useSettings((s) => s.settings);
  const entries = useLibrary((s) => s.entries);
  return useMemo(() => subscriptionsOf(settings, entries), [settings, entries]);
}
