import { useTranslation } from 'react-i18next';
import { useUi } from '../../store/ui';
import { Icon } from '../Icon';

export function EmptyState() {
  const { t } = useTranslation();
  const openDialog = useUi((s) => s.openDialog);

  return (
    <div className="story__placeholder">
      <section className="empty-state" aria-labelledby="empty-state-title">
        <Icon name="logo" size={44} className="empty-state__mark" />
        <h1 id="empty-state-title" className="empty-state__title">
          {t('empty.title')}
        </h1>
        <p className="empty-state__lead">{t('empty.lead')}</p>
        <p className="empty-state__detail">{t('empty.detail')}</p>
        <button type="button" className="btn btn--primary btn--large" onClick={() => openDialog('newGame')}>
          <Icon name="plus" size={18} />
          {t('empty.cta')}
        </button>
      </section>
    </div>
  );
}
