import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError } from '../../lib/describe';
import { useGame } from '../../store/game';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';
import { ComposerArea } from './ComposerArea';
import { DemoBanner } from './DemoBanner';
import { EmptyState } from './EmptyState';
import { MessageLog } from './MessageLog';
import { SceneHeader } from './SceneHeader';

/** The center column: scene header, story log and composer. */
export function StoryView({ narrow }: { narrow: boolean }) {
  const { t } = useTranslation();
  const session = useGame((s) => s.current);
  const opening = useGame((s) => s.opening);
  const openError = useGame((s) => s.openError);
  const openSession = useGame((s) => s.openSession);
  const openDrawer = useUi((s) => s.openDrawer);

  const worldTitle = session?.world.title ?? '';
  const appName = t('app.name');
  useEffect(() => {
    document.title = worldTitle ? `${worldTitle} · ${appName}` : appName;
  }, [worldTitle, appName]);

  let body: ReactNode;
  if (session) {
    body = (
      <>
        <MessageLog session={session} />
        <ComposerArea session={session} />
      </>
    );
  } else if (opening) {
    body = (
      <div className="story__placeholder" role="status">
        <p className="muted">{t('story.opening')}</p>
      </div>
    );
  } else if (openError) {
    body = (
      <div className="story__placeholder">
        <div className="notice notice--error" role="alert">
          <Icon name="alert" className="notice__icon" />
          <div>
            <p className="notice__title">{t('story.openFailed')}</p>
            <p>{describeError(t, openError.error)}</p>
            {openError.error.code !== 'not_found' && (
              <button type="button" className="btn btn--small notice__action" onClick={() => void openSession(openError.id)}>
                <Icon name="retry" size={16} />
                {t('common.retry')}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  } else {
    body = <EmptyState />;
  }

  return (
    <div className="story">
      {(session || narrow) && (
        <header className="story__bar">
          {narrow && (
            <button type="button" className="icon-btn" aria-label={t('header.openSessions')} onClick={() => openDrawer('sessions')}>
              <Icon name="menu" size={20} />
            </button>
          )}
          {session ? <SceneHeader session={session} /> : <span className="story__bar-title">{appName}</span>}
          {narrow && (
            <button type="button" className="icon-btn" aria-label={t('header.openWorld')} onClick={() => openDrawer('world')}>
              <Icon name="compass" size={20} />
            </button>
          )}
        </header>
      )}
      <DemoBanner />
      {body}
    </div>
  );
}
