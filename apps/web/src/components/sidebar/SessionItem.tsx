import type { SessionSummary } from '@roleplay/shared';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { languageTag } from '../../i18n';
import { snippet } from '../../lib/text';
import { formatRelativeTime } from '../../lib/time';
import { useGame } from '../../store/game';
import { Icon } from '../Icon';

interface SessionItemProps {
  summary: SessionSummary;
  active: boolean;
  now: number;
  intlLocale: string;
  onOpen: () => void;
}

export function SessionItem({ summary, active, now, intlLocale, onOpen }: SessionItemProps) {
  const { t } = useTranslation();
  const deleteSession = useGame((s) => s.deleteSession);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  // Move focus into the confirmation and back to the trash button when it closes.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (wasConfirming.current) deleteRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  const title = summary.title || snippet(summary.premise) || t('sidebar.untitled');
  const turns = summary.turn > 0 ? t('sidebar.turns', { count: summary.turn }) : t('sidebar.notStarted');
  const updated = formatRelativeTime(summary.updatedAt, intlLocale, now) ?? t('time.justNow');
  const languageName = t(`lang.name.${summary.language}`);

  const confirmDelete = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await deleteSession(summary.id);
      // On success this item unmounts.
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  if (confirming) {
    return (
      <li className="session session--confirm">
        <p className="session__confirm-text" role="alert">
          {failed ? t('sidebar.deleteFailed') : t('sidebar.confirmDelete')}
        </p>
        <div className="session__confirm-actions">
          <button type="button" className="btn btn--danger btn--small" disabled={busy} onClick={() => void confirmDelete()}>
            {t('common.delete')}
          </button>
          <button
            ref={cancelRef}
            type="button"
            className="btn btn--ghost btn--small"
            disabled={busy}
            onClick={() => {
              setConfirming(false);
              setFailed(false);
            }}
          >
            {t('common.cancel')}
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className={active ? 'session is-active' : 'session'}>
      <button type="button" className="session__open" aria-current={active ? 'page' : undefined} onClick={onOpen}>
        <span className="session__title" lang={summary.title || summary.premise ? languageTag(summary.language) : undefined}>
          {title}
        </span>
        <span className="session__meta">
          <span>{turns}</span>
          <span aria-hidden="true">·</span>
          <span>{updated}</span>
          <span className="lang-badge" title={t('sidebar.storyIn', { language: languageName })}>
            <span aria-hidden="true">{t(`lang.short.${summary.language}`)}</span>
            <span className="sr-only">{t('sidebar.storyIn', { language: languageName })}</span>
          </span>
        </span>
      </button>
      <button
        ref={deleteRef}
        type="button"
        className="icon-btn session__delete"
        aria-label={t('sidebar.deleteGame', { title })}
        title={t('common.delete')}
        onClick={() => setConfirming(true)}
      >
        <Icon name="trash" size={16} />
      </button>
    </li>
  );
}
