import type { PublicSettings, UpdateSettingsRequest } from '@roleplay/shared';
import { create } from 'zustand';
import { api } from '../api/client';
import type { LoadStatus } from './game';

interface SettingsState {
  settings: PublicSettings | null;
  status: LoadStatus;
  load: () => Promise<void>;
  /** Resolves with the saved settings; throws a RequestError when the server rejects the update. */
  save: (update: UpdateSettingsRequest) => Promise<PublicSettings>;
}

export const useSettings = create<SettingsState>()((set, get) => ({
  settings: null,
  status: 'idle',

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
}));
