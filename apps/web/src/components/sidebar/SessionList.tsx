import { useTranslation } from 'react-i18next';
import { useLocale, languageTag } from '../../i18n';
import { useNow } from '../../lib/time';
import { useGame } from '../../store/game';
import { SessionItem } from './SessionItem';

export function SessionList({ onOpened }: { onOpened?: () => void }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const now = useNow();
  const sessions = useGame((s) => s.sessions);
  const status = useGame((s) => s.sessionsStatus);
  const activeId = useGame((s) => s.current?.id ?? s.opening ?? s.openError?.id ?? null);
  const openSession = useGame((s) => s.openSession);
  const refreshSessions = useGame((s) => s.refreshSessions);

  if (sessions.length === 0) {
    if (status === 'loading' || status === 'idle') return <p className="sidebar__note">{t('sidebar.loading')}</p>;
    if (status === 'error') {
      return (
        <div className="sidebar__note">
          <p>{t('sidebar.loadFailed')}</p>
          <button type="button" className="link-btn" onClick={() => void refreshSessions()}>
            {t('common.retry')}
          </button>
        </div>
      );
    }
    return <p className="sidebar__note">{t('sidebar.empty')}</p>;
  }

  return (
    <ul className="session-list">
      {sessions.map((summary) => (
        <SessionItem
          key={summary.id}
          summary={summary}
          active={summary.id === activeId}
          now={now}
          intlLocale={languageTag(locale)}
          onOpen={() => {
            void openSession(summary.id);
            onOpened?.();
          }}
        />
      ))}
    </ul>
  );
}
