import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Lightbox } from './components/Lightbox';
import { Modal } from './components/Modal';
import { NewGameDialog } from './components/dialogs/NewGameDialog';
import { SettingsDialog } from './components/dialogs/SettingsDialog';
import { ModuleLibrary } from './components/library/ModuleLibrary';
import { Sidebar } from './components/sidebar/Sidebar';
import { StoryView } from './components/story/StoryView';
import { CharacterDossierModal } from './components/world/CharacterDossierModal';
import { WorldPanel } from './components/world/WorldPanel';
import { NARROW_QUERY, useMediaQuery } from './lib/useMediaQuery';
import { useGame } from './store/game';
import { useSettings } from './store/settings';
import { useUi } from './store/ui';

export function App() {
  const { t } = useTranslation();
  const narrow = useMediaQuery(NARROW_QUERY);
  const dialog = useUi((s) => s.dialog);
  const settingsOverlay = useUi((s) => s.settingsOverlay);
  const closeSettingsOverlay = useUi((s) => s.closeSettingsOverlay);
  const drawer = useUi((s) => s.drawer);
  const lightbox = useUi((s) => s.lightbox);
  const library = useUi((s) => s.library !== null);
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
    <div className="app">
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

      {dialog === 'newGame' && <NewGameDialog />}
      {dialog === 'settings' && <SettingsDialog />}
      {dialog === 'newGame' && settingsOverlay && <SettingsDialog onClose={closeSettingsOverlay} />}
      {/* After the dialogs, so it opens on top of the one it was opened from. */}
      {library && <ModuleLibrary />}
      <CharacterDossierModal />
      {lightbox && <Lightbox key={lightbox.url} image={lightbox} />}
    </div>
  );
}
