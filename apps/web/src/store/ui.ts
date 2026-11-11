import type { ModuleId } from '@roleplay/shared';
import { create } from 'zustand';

export type DialogKind = 'newGame' | 'settings';
export type DrawerKind = 'sessions' | 'world';
/**
 * The world panel's views kept by play modules. Each is listed only while its
 * module has something to show, in a row of its own above the world's tabs.
 */
export const MODULE_VIEWS = [
  'combat',
  'court',
  'lineage',
  'domain',
  'espionage',
  'progression',
  'clocks',
  'calendar',
  'bonds',
  'sandbox',
  'market',
  'clues',
  'travel',
  'deck',
  'reputation',
] as const;
export type ModuleView = (typeof MODULE_VIEWS)[number];
/** The world's own tabs: always there. */
export const WORLD_TABS = ['characters', 'inventory', 'quests', 'places', 'lore'] as const;
export type WorldTab = ModuleView | (typeof WORLD_TABS)[number] | `custom:${string}`;

export interface LightboxImage {
  url: string;
  caption: string;
  /** Story language tag of the caption. */
  lang: string;
}

/** The module library, open on one module or on the whole list. */
export interface LibraryView {
  moduleId: ModuleId | null;
}

interface UiState {
  dialog: DialogKind | null;
  /** Stacks Settings on top of New Game so the player can configure a key without losing their scenario chat. */
  settingsOverlay: boolean;
  drawer: DrawerKind | null;
  lightbox: LightboxImage | null;
  /** Character id currently open in the full portrait & dossier modal. */
  dossierCharacterId: string | null;
  /** Stacks on top of a dialog, so the new-game form keeps what was typed while the player subscribes. */
  library: LibraryView | null;
  /** The world tab the player picked; null until they pick one, which shows the first tab the story has. */
  worldTab: WorldTab | null;
  showSecrets: boolean;
  /** Widens the desktop world/module panel into a strategy command workspace. */
  workspaceExpanded: boolean;
  openDialog: (dialog: DialogKind) => void;
  closeDialog: () => void;
  closeSettingsOverlay: () => void;
  openDrawer: (drawer: DrawerKind) => void;
  closeDrawer: () => void;
  openLightbox: (image: LightboxImage) => void;
  closeLightbox: () => void;
  openDossier: (characterId: string) => void;
  closeDossier: () => void;
  openLibrary: (moduleId?: ModuleId) => void;
  closeLibrary: () => void;
  setWorldTab: (tab: WorldTab) => void;
  setShowSecrets: (show: boolean) => void;
  toggleWorkspaceExpanded: () => void;
}

export const useUi = create<UiState>()((set) => ({
  dialog: null,
  settingsOverlay: false,
  drawer: null,
  lightbox: null,
  dossierCharacterId: null,
  library: null,
  worldTab: null,
  showSecrets: false,
  workspaceExpanded: false,
  // A dialog opened from inside a drawer replaces it rather than stacking on top.
  // Opening settings while `newGame` is open stacks on top so scenario drafts/chats are preserved.
  openDialog: (dialog) =>
    set((s) =>
      dialog === 'settings' && s.dialog === 'newGame'
        ? { settingsOverlay: true, drawer: null, dossierCharacterId: null }
        : { dialog, settingsOverlay: false, drawer: null, dossierCharacterId: null },
    ),
  closeDialog: () => set({ dialog: null, settingsOverlay: false }),
  closeSettingsOverlay: () => set({ settingsOverlay: false }),
  openDrawer: (drawer) => set({ drawer }),
  closeDrawer: () => set({ drawer: null }),
  // The lightbox may stack on a drawer or dossier modal; closing it returns there.
  openLightbox: (lightbox) => set({ lightbox }),
  closeLightbox: () => set({ lightbox: null }),
  openDossier: (characterId) => set({ dossierCharacterId: characterId }),
  closeDossier: () => set({ dossierCharacterId: null }),
  openLibrary: (moduleId) => set({ library: { moduleId: moduleId ?? null }, drawer: null, dossierCharacterId: null }),
  closeLibrary: () => set({ library: null }),
  setWorldTab: (worldTab) => set({ worldTab }),
  setShowSecrets: (showSecrets) => set({ showSecrets }),
  toggleWorkspaceExpanded: () => set((s) => ({ workspaceExpanded: !s.workspaceExpanded })),
}));
