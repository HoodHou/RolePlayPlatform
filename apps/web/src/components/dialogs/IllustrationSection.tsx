import { DEFAULT_IMAGE_MODEL, DEFAULT_OPENAI_BASE_URL, IMAGE_QUALITIES, type ImageQuality, type PublicSettings } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { ApiKeyField } from './ApiKeyField';
import { ModelField } from './ModelField';
import type { ModelListProps } from './ProviderSections';
import type { SettingsFormState } from './formState';

function isQuality(value: string): value is ImageQuality {
  return (IMAGE_QUALITIES as readonly string[]).includes(value);
}

/** What the saved settings mean for painting right now, or that the switch takes effect on save. */
function paintingStatus(saved: PublicSettings, enabled: boolean) {
  if (enabled !== saved.image.enabled) return enabled ? 'pendingOn' : 'pendingOff';
  if (saved.illustrationsActive) return saved.activeProvider === 'mock' ? 'demo' : 'active';
  return saved.image.enabled ? 'notReady' : 'off';
}

interface IllustrationSectionProps {
  id: string;
  value: SettingsFormState['image'];
  saved: PublicSettings;
  onChange: (patch: Partial<SettingsFormState['image']>) => void;
  models: ModelListProps;
}

export function IllustrationSection({ id, value, saved, onChange, models }: IllustrationSectionProps) {
  const { t } = useTranslation();
  const status = paintingStatus(saved, value.enabled);

  return (
    <section className="settings-section" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="settings-section__title">
        {t('settings.illustrations.legend')}
      </h3>
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
          <ApiKeyField
            id={`${id}-key`}
            source={saved.image.apiKeySource}
            edit={value.key}
            onChange={(key) => onChange({ key })}
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
              placeholder={DEFAULT_OPENAI_BASE_URL}
              onChange={(event) => onChange({ baseUrl: event.target.value })}
            />
            <p className="field__hint">{t('settings.illustrations.baseUrlHint')}</p>
          </div>
          <ModelField
            id={`${id}-model`}
            value={value.model}
            placeholder={DEFAULT_IMAGE_MODEL}
            hint={t('settings.illustrations.modelDefaultHint', { model: DEFAULT_IMAGE_MODEL })}
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
