import { create } from 'zustand';

export type DialogKind = 'newGame' | 'settings';
export type DrawerKind = 'sessions' | 'world';
export const WORLD_TABS = ['characters', 'inventory', 'quests', 'places', 'lore'] as const;
export type WorldTab = (typeof WORLD_TABS)[number];

export interface LightboxImage {
  url: string;
  caption: string;
  /** Story language tag of the caption. */
  lang: string;
}

interface UiState {
  dialog: DialogKind | null;
  drawer: DrawerKind | null;
  lightbox: LightboxImage | null;
  worldTab: WorldTab;
  showSecrets: boolean;
  openDialog: (dialog: DialogKind) => void;
  closeDialog: () => void;
  openDrawer: (drawer: DrawerKind) => void;
  closeDrawer: () => void;
  openLightbox: (image: LightboxImage) => void;
  closeLightbox: () => void;
  setWorldTab: (tab: WorldTab) => void;
  setShowSecrets: (show: boolean) => void;
}

export const useUi = create<UiState>()((set) => ({
  dialog: null,
  drawer: null,
  lightbox: null,
  worldTab: 'characters',
  showSecrets: false,
  // A dialog opened from inside a drawer replaces it rather than stacking on top.
  openDialog: (dialog) => set({ dialog, drawer: null }),
  closeDialog: () => set({ dialog: null }),
  openDrawer: (drawer) => set({ drawer }),
  closeDrawer: () => set({ drawer: null }),
  // The lightbox may stack on a drawer (e.g. a portrait in the world drawer); closing it returns there.
  openLightbox: (lightbox) => set({ lightbox }),
  closeLightbox: () => set({ lightbox: null }),
  setWorldTab: (worldTab) => set({ worldTab }),
  setShowSecrets: (showSecrets) => set({ showSecrets }),
}));
