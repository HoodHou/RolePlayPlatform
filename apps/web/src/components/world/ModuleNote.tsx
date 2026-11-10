import type { ModuleId } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import type { StoryRelation } from '../../lib/modules';
import { useUi } from '../../store/ui';

/**
 * Over a module's view in the world panel when the story does not play it:
 * what it shows is still the world, as the module left it. Out of play (not
 * subscribed) also offers the way back, through the library.
 */
export function ModuleNote({ id, relation }: { id: ModuleId; relation: StoryRelation }) {
  const { t } = useTranslation();
  const openLibrary = useUi((s) => s.openLibrary);
  if (relation === 'on') return null;

  const name = t(`modules.names.${id}`);
  const subscribed = relation === 'off';
  return (
    <div className="module-note">
      <p>{subscribed ? t('world.moduleOff', { name }) : t('world.moduleOutOfPlay', { name })}</p>
      {!subscribed && (
        <button type="button" className="link-btn module-note__action" onClick={() => openLibrary(id)}>
          {t('modules.openInLibrary')}
        </button>
      )}
    </div>
  );
}
