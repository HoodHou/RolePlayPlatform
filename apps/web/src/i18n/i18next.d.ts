import type { Messages } from './locales/en';

// Typed keys: a call like t('story.sned') is a compile error.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: Messages };
  }
}
