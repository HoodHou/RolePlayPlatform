import { useTranslation } from 'react-i18next';
import { describeError } from '../../lib/describe';
import { useGame, type TurnFailure } from '../../store/game';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';

const SETTINGS_CODES = new Set(['not_configured', 'auth_failed']);

export function TurnErrorBanner({ failure }: { failure: TurnFailure }) {
  const { t } = useTranslation();
  const retry = useGame((s) => s.retry);
  const dismiss = useGame((s) => s.dismissFailure);
  const openDialog = useUi((s) => s.openDialog);

  return (
    <div className="notice notice--error turn-error" role="alert">
      <Icon name="alert" className="notice__icon" />
      <div className="notice__body">
        <p>{describeError(t, failure.error)}</p>
        <div className="notice__actions">
          {failure.retryable && (
            <button type="button" className="btn btn--small" onClick={retry}>
              <Icon name="retry" size={16} />
              {t('common.retry')}
            </button>
          )}
          {SETTINGS_CODES.has(failure.error.code) && (
            <button type="button" className="btn btn--small" onClick={() => openDialog('settings')}>
              <Icon name="settings" size={16} />
              {t('common.openSettings')}
            </button>
          )}
        </div>
      </div>
      <button type="button" className="icon-btn notice__dismiss" aria-label={t('common.dismiss')} onClick={dismiss}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
