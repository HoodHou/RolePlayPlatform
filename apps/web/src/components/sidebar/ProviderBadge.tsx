import { CONNECTION_DEFAULTS } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../store/settings';

/** Who is telling the story, and whether that connection still needs setting up. */
export function ProviderBadge() {
  const { t } = useTranslation();
  const settings = useSettings((s) => s.settings);
  if (!settings) return null;

  const kind = settings.gameMaster.provider;
  const connection = kind === 'mock' ? null : settings.connections[kind];
  // A custom endpoint needs an address (a local one may need no key); the others need a key.
  const needsSetup =
    connection !== null && connection !== undefined &&
    (kind === 'custom' ? connection.baseUrl.trim() === '' : connection.apiKeySource === 'none');
  const name = t(`provider.${kind}`);
  const model =
    kind === 'mock' ? '' : settings.gameMaster.model || connection?.model || CONNECTION_DEFAULTS[kind].model;
  const spoken = needsSetup ? t('sidebar.providerAriaSetup', { name }) : t('sidebar.providerAria', { name });

  return (
    <p
      className={`provider-badge provider-badge--${kind}${needsSetup ? ' is-warning' : ''}`}
      title={model ? `${name} · ${model}` : name}
    >
      <span className="provider-badge__dot" aria-hidden="true" />
      <span className="provider-badge__name" aria-hidden="true">
        {name}
      </span>
      {model && (
        <span className="provider-badge__model" aria-hidden="true">
          {model}
        </span>
      )}
      {needsSetup && (
        <span className="provider-badge__warning" aria-hidden="true">
          {t('sidebar.needsSetup')}
        </span>
      )}
      <span className="sr-only">{spoken}</span>
    </p>
  );
}
