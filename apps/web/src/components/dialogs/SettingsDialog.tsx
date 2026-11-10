import { useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../store/settings';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';
import { Modal } from '../Modal';
import { SettingsForm } from './SettingsForm';

export function SettingsDialog() {
  const { t } = useTranslation();
  const close = useUi((s) => s.closeDialog);
  const settings = useSettings((s) => s.settings);
  const status = useSettings((s) => s.status);
  const load = useSettings((s) => s.load);
  const titleId = useId();

  // Settings normally load at startup; try again if that failed.
  useEffect(() => {
    if (useSettings.getState().settings === null) void load();
  }, [load]);

  const header = (
    <header className="dialog__head">
      <h2 id={titleId} className="dialog__title">
        {t('settings.title')}
      </h2>
      <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={close}>
        <Icon name="close" />
      </button>
    </header>
  );

  return (
    <Modal labelledBy={titleId} onClose={close} wide>
      {settings ? (
        <SettingsForm settings={settings} header={header} onClose={close} />
      ) : (
        <div className="dialog">
          {header}
          <div className="dialog__body">
            {status === 'error' ? (
              <div className="form-error" role="alert">
                <p className="form-error__title">{t('settings.loadFailed')}</p>
                <button type="button" className="btn btn--small" onClick={() => void load()}>
                  <Icon name="retry" size={16} />
                  {t('common.retry')}
                </button>
              </div>
            ) : (
              <p className="muted" role="status">
                {t('settings.loading')}
              </p>
            )}
          </div>
          <footer className="dialog__foot">
            <button type="button" className="btn btn--ghost" onClick={close}>
              {t('common.close')}
            </button>
          </footer>
        </div>
      )}
    </Modal>
  );
}
