import { useTranslation } from 'react-i18next';
import { useSettings } from '../../store/settings';

export function ProviderBadge() {
  const { t } = useTranslation();
  const settings = useSettings((s) => s.settings);
  if (!settings) return null;

  const kind = settings.activeProvider;
  const openaiModel = settings.openaiCompatible.model.trim();
  // OpenAI-compatible servers such as Ollama need no key, but they do need a model.
  const needsSetup =
    (kind === 'anthropic' && settings.anthropic.apiKeySource === 'none') ||
    (kind === 'openai-compatible' && openaiModel === '');
  const name = kind === 'openai-compatible' && openaiModel ? openaiModel : t(`provider.${kind}`);
  const detail = kind === 'anthropic' ? settings.anthropic.model : '';
  const spoken = needsSetup ? t('sidebar.providerAriaSetup', { name }) : t('sidebar.providerAria', { name });

  return (
    <p
      className={`provider-badge provider-badge--${kind}${needsSetup ? ' is-warning' : ''}`}
      title={detail ? `${name} · ${detail}` : name}
    >
      <span className="provider-badge__dot" aria-hidden="true" />
      <span className="provider-badge__name" aria-hidden="true">
        {name}
      </span>
      {needsSetup && (
        <span className="provider-badge__warning" aria-hidden="true">
          {t('sidebar.needsSetup')}
        </span>
      )}
      <span className="sr-only">{spoken}</span>
    </p>
  );
}
