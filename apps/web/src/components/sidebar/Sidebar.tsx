import type { Session, SessionBackup } from '@roleplay/shared';
import { useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toUiError } from '../../api/errors';
import { describeError } from '../../lib/describe';
import { useGame } from '../../store/game';
import { useSubscriptions } from '../../store/library';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';
import { LanguageToggle } from './LanguageToggle';
import { ProviderBadge } from './ProviderBadge';
import { SessionList } from './SessionList';

interface SidebarProps {
  /** Present when shown as a drawer. */
  onClose?: () => void;
}

function coerceSessionBackup(value: unknown): SessionBackup | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  if (obj.session && typeof obj.session === 'object') {
    const session = obj.session as Session;
    if (session.world && Array.isArray(session.messages)) {
      return {
        version: 1,
        exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
        session,
        images: obj.images && typeof obj.images === 'object' ? (obj.images as SessionBackup['images']) : {},
      };
    }
  }
  if (obj.world && typeof obj.world === 'object' && Array.isArray(obj.messages)) {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      session: obj as unknown as Session,
      images: {},
    };
  }
  return null;
}

export function Sidebar({ onClose }: SidebarProps) {
  const { t } = useTranslation();
  const openDialog = useUi((s) => s.openDialog);
  const openLibrary = useUi((s) => s.openLibrary);
  const importSave = useGame((s) => s.importSave);
  const subscriptions = useSubscriptions();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const onFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImporting(true);
    setImportError(null);
    try {
      const raw = await file.text();
      const parsed = coerceSessionBackup(JSON.parse(raw));
      if (!parsed) {
        setImportError(t('sidebar.importInvalid'));
        return;
      }
      await importSave(parsed);
      onClose?.();
    } catch (err) {
      if (err instanceof SyntaxError) {
        setImportError(t('sidebar.importInvalid'));
      } else {
        setImportError(describeError(t, toUiError(err)));
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="sidebar">
      <div className="sidebar__brand">
        <Icon name="logo" size={22} className="sidebar__logo" />
        <span className="sidebar__name">{t('app.name')}</span>
        {onClose && (
          <button type="button" className="icon-btn sidebar__close" aria-label={t('common.close')} onClick={onClose}>
            <Icon name="close" />
          </button>
        )}
      </div>

      <button type="button" className="btn btn--primary sidebar__new" onClick={() => openDialog('newGame')}>
        <Icon name="plus" size={16} />
        {t('sidebar.newGame')}
      </button>

      <nav className="sidebar__sessions" aria-label={t('sidebar.label')}>
        <div className="sidebar__sessions-head">
          <h2 className="eyebrow sidebar__heading">{t('sidebar.savedGames')}</h2>
          <button
            type="button"
            className="sidebar__import-btn"
            disabled={importing}
            title={t('sidebar.importSaveHint')}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="upload" size={13} />
            <span>{t('sidebar.importSave')}</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => void onFileSelected(e)}
          />
        </div>
        {importError && (
          <p className="sidebar__import-error" role="alert">
            <span>{importError}</span>
            <button
              type="button"
              className="icon-btn sidebar__import-dismiss"
              aria-label={t('common.close')}
              onClick={() => setImportError(null)}
            >
              <Icon name="close" size={13} />
            </button>
          </p>
        )}
        <SessionList onOpened={onClose} />
      </nav>

      <div className="sidebar__footer">
        {/* The library is reached from here at any time, not only while choosing a story's modules. */}
        <button type="button" className="sidebar__library" aria-haspopup="dialog" onClick={() => openLibrary()}>
          <Icon name="modules" size={16} />
          <span className="sidebar__library-name">{t('sidebar.library')}</span>
          {subscriptions && (
            <span className="sidebar__library-count">{t('sidebar.libraryCount', { count: subscriptions.length })}</span>
          )}
        </button>
        <div className="sidebar__footer-row">
          <LanguageToggle />
          <button type="button" className="btn btn--ghost btn--small" onClick={() => openDialog('settings')}>
            <Icon name="settings" size={16} />
            {t('sidebar.settings')}
          </button>
        </div>
        <ProviderBadge />
      </div>
    </div>
  );
}
