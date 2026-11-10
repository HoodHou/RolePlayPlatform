import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_BASE_URL,
  EFFORTS,
  OPENAI_COMPAT_PRESETS,
  type Effort,
  type KeySource,
} from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { ApiKeyField } from './ApiKeyField';
import { ModelField, type ModelFetch } from './ModelField';
import type { SettingsFormState } from './formState';

export interface ModelListProps {
  fetch: ModelFetch;
  needsSave: boolean;
  busy: boolean;
  onFetch: () => void;
}

function isEffort(value: string): value is Effort {
  return (EFFORTS as readonly string[]).includes(value);
}

interface AnthropicSectionProps {
  id: string;
  keyFieldId: string;
  value: SettingsFormState['anthropic'];
  keySource: KeySource;
  onChange: (patch: Partial<SettingsFormState['anthropic']>) => void;
  models: ModelListProps;
}

export function AnthropicSection({ id, keyFieldId, value, keySource, onChange, models }: AnthropicSectionProps) {
  const { t } = useTranslation();
  return (
    <div className="provider-config">
      <ApiKeyField id={keyFieldId} source={keySource} edit={value.key} onChange={(key) => onChange({ key })} />
      <ModelField
        id={`${id}-model`}
        value={value.model}
        placeholder={DEFAULT_ANTHROPIC_MODEL}
        hint={t('settings.modelDefaultHint', { model: DEFAULT_ANTHROPIC_MODEL })}
        onChange={(model) => onChange({ model })}
        {...models}
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
          placeholder="https://api.anthropic.com"
          onChange={(event) => onChange({ baseUrl: event.target.value })}
        />
        <p className="field__hint">{t('settings.baseUrlOptionalHint')}</p>
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-effort`}>
          {t('settings.effort')}
        </label>
        <select
          id={`${id}-effort`}
          className="input select"
          value={value.effort ?? ''}
          onChange={(event) => onChange({ effort: isEffort(event.target.value) ? event.target.value : null })}
        >
          <option value="">{t('settings.effortLevels.default')}</option>
          {EFFORTS.map((level) => (
            <option key={level} value={level}>
              {t(`settings.effortLevels.${level}`)}
            </option>
          ))}
        </select>
        <p className="field__hint">{t('settings.effortHint')}</p>
      </div>
    </div>
  );
}

interface OpenAISectionProps {
  id: string;
  keyFieldId: string;
  value: SettingsFormState['openai'];
  keySource: KeySource;
  onChange: (patch: Partial<SettingsFormState['openai']>) => void;
  models: ModelListProps;
}

export function OpenAISection({ id, keyFieldId, value, keySource, onChange, models }: OpenAISectionProps) {
  const { t } = useTranslation();
  return (
    <div className="provider-config">
      <ApiKeyField
        id={keyFieldId}
        source={keySource}
        edit={value.key}
        onChange={(key) => onChange({ key })}
        extraHint={t('settings.localKeyHint')}
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
        <div className="preset-row" role="group" aria-labelledby={`${id}-quick-fill`}>
          <span id={`${id}-quick-fill`} className="field__hint">
            {t('settings.quickFill')}
          </span>
          {OPENAI_COMPAT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="chip-button"
              aria-pressed={value.baseUrl.trim() === preset.baseUrl}
              title={preset.model ? `${preset.baseUrl} · ${preset.model}` : preset.baseUrl}
              onClick={() => onChange(preset.model ? { baseUrl: preset.baseUrl, model: preset.model } : { baseUrl: preset.baseUrl })}
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>
      <ModelField
        id={`${id}-model`}
        value={value.model}
        placeholder={t('settings.modelPlaceholder')}
        hint={t('settings.modelRequiredHint')}
        warning={value.model.trim() === ''}
        onChange={(model) => onChange({ model })}
        {...models}
      />
    </div>
  );
}
