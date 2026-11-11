import type { CustomModuleState } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';

/**
 * World panel view for an installed custom plugin (`world.modules.custom[id]`).
 */
export function CustomModuleTab({ state, lang }: { state: CustomModuleState; lang: string }) {
  const { t } = useTranslation();
  const entries = Object.values(state.entries);

  if (entries.length === 0) {
    return <p className="tab-empty">{t('world.emptyCustomModule')}</p>;
  }

  return (
    <ul className="cards">
      {entries.map((entry) => {
        const pairs = Object.entries(entry.values);
        return (
          <li key={entry.id} className="card">
            <div className="card__head">
              <h4 className="card__title" lang={lang}>
                {entry.name}
              </h4>
            </div>
            {pairs.length > 0 && (
              <dl className="facts">
                {pairs.map(([key, value]) => (
                  <div key={key} className="facts__row">
                    <dt>{key}</dt>
                    <dd lang={lang}>
                      {typeof value === 'boolean' ? (value ? t('common.yes') : t('common.no')) : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        );
      })}
    </ul>
  );
}
