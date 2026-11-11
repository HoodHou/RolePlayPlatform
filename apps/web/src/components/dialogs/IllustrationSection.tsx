import {
  IMAGE_MODEL_PRESETS,
  IMAGE_PROVIDER_DEFAULTS,
  IMAGE_PROVIDERS,
  IMAGE_QUALITIES,
  type ImageProviderKind,
  type ImageQuality,
  type PublicSettings,
} from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { ApiKeyField } from './ApiKeyField';
import { effectiveImageKeySource, type SettingsFormState } from './formState';
import { ModelField, type ModelListProps } from './ModelField';

function isQuality(value: string): value is ImageQuality {
  return (IMAGE_QUALITIES as readonly string[]).includes(value);
}

function isImageProvider(value: string): value is ImageProviderKind {
  return (IMAGE_PROVIDERS as readonly string[]).includes(value);
}

/** What the saved settings mean for painting right now, or that the switch takes effect on save. */
function paintingStatus(saved: PublicSettings, form: SettingsFormState['image']) {
  if (form.enabled !== saved.image.enabled) return form.enabled ? 'pendingOn' : 'pendingOff';
  if (form.enabled && form.provider !== saved.image.provider) return 'pendingOn';
  if (saved.illustrationsActive) return saved.gameMaster.provider === 'mock' ? 'demo' : 'active';
  return saved.image.enabled ? 'notReady' : 'off';
}

interface IllustrationSectionProps {
  id: string;
  form: SettingsFormState;
  saved: PublicSettings;
  onChange: (patch: Partial<SettingsFormState['image']>) => void;
  models: ModelListProps;
}

export function IllustrationSection({ id, form, saved, onChange, models }: IllustrationSectionProps) {
  const { t } = useTranslation();
  const value = form.image;
  const status = paintingStatus(saved, value);
  const defaults = IMAGE_PROVIDER_DEFAULTS[value.provider];
  const isCustom = value.provider === 'custom';
  const missingUrl = isCustom && value.baseUrl.trim() === '';
  const keySource = effectiveImageKeySource(form, saved);

  return (
    <section className="settings-panel" aria-label={t('settings.illustrations.legend')}>
      <p className="field__hint">{t('settings.illustrations.intro')}</p>

      <label className="switch">
        <input
          type="checkbox"
          role="switch"
          className="switch__input"
          checked={value.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
        <span className="switch__track" aria-hidden="true" />
        <span className="switch__label">{t('settings.illustrations.enable')}</span>
      </label>
      <p className={`status-line status-line--${status}`}>
        <span className="status-line__dot" aria-hidden="true" />
        {t(`settings.illustrations.status.${status}`)}
      </p>

      {value.enabled && (
        <div className="provider-config">
          <div className="field">
            <label className="field__label" htmlFor={`${id}-provider`}>
              {t('settings.illustrations.provider')}
            </label>
            <select
              id={`${id}-provider`}
              className="input select"
              value={value.provider}
              onChange={(event) => {
                if (isImageProvider(event.target.value)) onChange({ provider: event.target.value });
              }}
            >
              {IMAGE_PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>
                  {t(`settings.providers.${provider}.name`)}
                </option>
              ))}
            </select>
            <p className="field__hint">{t(`settings.illustrations.providerHints.${value.provider}`)}</p>
          </div>

          <ApiKeyField
            id={`${id}-key`}
            source={keySource}
            edit={value.key}
            onChange={(key) => onChange({ key })}
            extraHint={isCustom ? t('settings.connections.localKeyHint') : undefined}
          />

          <div className="field">
            <label className="field__label" htmlFor={`${id}-url`}>
              {t('settings.baseUrl')}
            </label>
            <input
              id={`${id}-url`}
              className="input input--mono"
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={value.baseUrl}
              placeholder={defaults.baseUrl || 'https://…/v1'}
              aria-describedby={`${id}-url-hint`}
              aria-invalid={missingUrl || undefined}
              onChange={(event) => onChange({ baseUrl: event.target.value })}
            />
            <p id={`${id}-url-hint`} className={missingUrl ? 'field__hint field__hint--warning' : 'field__hint'}>
              {t(`settings.illustrations.baseUrlHints.${value.provider}`)}
              {missingUrl && (
                <>
                  <br />
                  {t('settings.illustrations.customBaseUrlRequired')}
                </>
              )}
            </p>
          </div>

          <ModelField
            id={`${id}-model`}
            value={value.model}
            placeholder={defaults.model}
            presets={IMAGE_MODEL_PRESETS[value.provider]}
            hint={t('settings.illustrations.modelDefaultHint', { model: defaults.model })}
            onChange={(model) => onChange({ model })}
            {...models}
          />

          <div className="field">
            <label className="field__label" htmlFor={`${id}-quality`}>
              {t('settings.illustrations.quality')}
            </label>
            <select
              id={`${id}-quality`}
              className="input select"
              value={value.quality}
              onChange={(event) => {
                if (isQuality(event.target.value)) onChange({ quality: event.target.value });
              }}
            >
              {IMAGE_QUALITIES.map((quality) => (
                <option key={quality} value={quality}>
                  {t(`settings.illustrations.qualities.${quality}`)}
                </option>
              ))}
            </select>
            <p className="field__hint">{t('settings.illustrations.qualityHint')}</p>
          </div>
        </div>
      )}
    </section>
  );
}
