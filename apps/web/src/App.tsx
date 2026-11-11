import { lazy, Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Lightbox } from './components/Lightbox';
import { Modal } from './components/Modal';
import { Sidebar } from './components/sidebar/Sidebar';
import { StoryView } from './components/story/StoryView';
import { WorldPanel } from './components/world/WorldPanel';
import { NARROW_QUERY, useMediaQuery } from './lib/useMediaQuery';
import { useGame } from './store/game';
import { useSettings } from './store/settings';
import { useUi } from './store/ui';

const NewGameDialog = lazy(() =>
  import('./components/dialogs/NewGameDialog').then((m) => ({ default: m.NewGameDialog })),
);
const SettingsDialog = lazy(() =>
  import('./components/dialogs/SettingsDialog').then((m) => ({ default: m.SettingsDialog })),
);
const ModuleLibrary = lazy(() =>
  import('./components/library/ModuleLibrary').then((m) => ({ default: m.ModuleLibrary })),
);
const CharacterDossierModal = lazy(() =>
  import('./components/world/CharacterDossierModal').then((m) => ({ default: m.CharacterDossierModal })),
);

export function App() {
  const { t } = useTranslation();
  const narrow = useMediaQuery(NARROW_QUERY);
  const dialog = useUi((s) => s.dialog);
  const settingsOverlay = useUi((s) => s.settingsOverlay);
  const closeSettingsOverlay = useUi((s) => s.closeSettingsOverlay);
  const drawer = useUi((s) => s.drawer);
  const lightbox = useUi((s) => s.lightbox);
  const library = useUi((s) => s.library !== null);
  const dossierOpen = useUi((s) => s.dossierCharacterId !== null);
  const workspaceExpanded = useUi((s) => s.workspaceExpanded);
  const closeDrawer = useUi((s) => s.closeDrawer);

  useEffect(() => {
    void useGame.getState().init();
    void useSettings.getState().load();
  }, []);

  // Drawers only exist on narrow screens.
  useEffect(() => {
    if (!narrow) closeDrawer();
  }, [narrow, closeDrawer]);

  return (
    <div className={!narrow && workspaceExpanded ? 'app app--workspace' : 'app'}>
      {!narrow && (
        <aside className="app__sidebar">
          <Sidebar />
        </aside>
      )}
      <main className="app__main">
        <StoryView narrow={narrow} />
      </main>
      {!narrow && (
        <aside className="app__world" aria-label={t('world.label')}>
          <WorldPanel />
        </aside>
      )}

      {narrow && drawer === 'sessions' && (
        <Modal variant="drawer-left" label={t('sidebar.label')} onClose={closeDrawer} dismissOnBackdrop>
          <Sidebar onClose={closeDrawer} />
        </Modal>
      )}
      {narrow && drawer === 'world' && (
        <Modal variant="drawer-right" label={t('world.label')} onClose={closeDrawer} dismissOnBackdrop>
          <WorldPanel onClose={closeDrawer} />
        </Modal>
      )}

      <Suspense fallback={null}>
        {dialog === 'newGame' && <NewGameDialog />}
        {dialog === 'settings' && <SettingsDialog />}
        {dialog === 'newGame' && settingsOverlay && <SettingsDialog onClose={closeSettingsOverlay} />}
        {/* After the dialogs, so it opens on top of the one it was opened from. */}
        {library && <ModuleLibrary />}
        {dossierOpen && <CharacterDossierModal />}
      </Suspense>
      {lightbox && <Lightbox key={lightbox.url} image={lightbox} />}
    </div>
  );
}
