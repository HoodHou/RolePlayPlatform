import { LOCALES, type Locale } from '@roleplay/shared';
import i18n from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import { storage } from '../lib/storage';
import { en } from './locales/en';
import { zh } from './locales/zh';

const LANG_KEY = 'rp.lang';

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function toLocale(language: string | undefined): Locale {
  return language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** BCP 47 tag for `lang` attributes and Intl formatters. */
export function languageTag(locale: Locale): string {
  return locale === 'zh' ? 'zh-CN' : 'en';
}

function detectLocale(): Locale {
  const saved = storage.get(LANG_KEY);
  if (isLocale(saved)) return saved;
  return toLocale(navigator.language);
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, zh: { translation: zh } },
  lng: detectLocale(),
  fallbackLng: 'en',
  supportedLngs: LOCALES,
  initAsync: false,
  // React already escapes text; escaping here would show "&amp;" in names.
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

function syncDocumentLanguage(language: string): void {
  document.documentElement.lang = languageTag(toLocale(language));
}

syncDocumentLanguage(i18n.language);
i18n.on('languageChanged', syncDocumentLanguage);

export function setLocale(locale: Locale): void {
  storage.set(LANG_KEY, locale);
  void i18n.changeLanguage(locale);
}

/** The interface language (not the story language). */
export function useLocale(): Locale {
  const { i18n: instance } = useTranslation();
  return toLocale(instance.resolvedLanguage ?? instance.language);
}

export default i18n;
