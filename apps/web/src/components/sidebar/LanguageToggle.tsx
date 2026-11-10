import { LOCALES } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { languageTag, setLocale, useLocale } from '../../i18n';

export function LanguageToggle() {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <div className="segmented segmented--compact" role="group" aria-label={t('lang.toggleLabel')}>
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          className="segmented__button"
          aria-pressed={locale === option}
          lang={languageTag(option)}
          onClick={() => setLocale(option)}
        >
          {t(`lang.short.${option}`)}
        </button>
      ))}
    </div>
  );
}
