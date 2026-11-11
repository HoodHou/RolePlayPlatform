import type { ConnectionKind, PublicSettings, UpdateSettingsRequest } from '@roleplay/shared';
import { create } from 'zustand';
import { api } from '../api/client';
import type { LoadStatus } from './game';

interface SettingsState {
  settings: PublicSettings | null;
  status: LoadStatus;
  /** Cached live model lists fetched per connection during this browser session. */
  fetchedModels: Partial<Record<ConnectionKind, string[]>>;
  fetchingModels: Partial<Record<ConnectionKind, boolean>>;
  load: () => Promise<void>;
  /** Resolves with the saved settings; throws a RequestError when the server rejects the update. */
  save: (update: UpdateSettingsRequest) => Promise<PublicSettings>;
  /** Queries `/api/settings/models` for a configured connection and caches the result. */
  fetchModelsFor: (kind: ConnectionKind) => Promise<string[]>;
}

export const useSettings = create<SettingsState>()((set, get) => ({
  settings: null,
  status: 'idle',
  fetchedModels: {},
  fetchingModels: {},

  load: async () => {
    if (get().status === 'loading') return;
    set({ status: 'loading' });
    try {
      set({ settings: await api.getSettings(), status: 'ready' });
    } catch {
      set({ status: 'error' });
    }
  },

  save: async (update) => {
    const settings = await api.updateSettings(update);
    set({ settings, status: 'ready' });
    return settings;
  },

  fetchModelsFor: async (kind) => {
    if (get().fetchingModels[kind]) return get().fetchedModels[kind] ?? [];
    set((s) => ({ fetchingModels: { ...s.fetchingModels, [kind]: true } }));
    try {
      const { models } = await api.listModels(kind);
      set((s) => ({
        fetchedModels: { ...s.fetchedModels, [kind]: models },
        fetchingModels: { ...s.fetchingModels, [kind]: false },
      }));
      return models;
    } catch {
      set((s) => ({ fetchingModels: { ...s.fetchingModels, [kind]: false } }));
      return get().fetchedModels[kind] ?? [];
    }
  },
}));
