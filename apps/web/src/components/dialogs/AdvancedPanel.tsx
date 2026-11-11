import { GENERATION_DEFAULTS, GENERATION_LIMITS } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import {
  DEFAULT_GENERATION_FORM,
  GENERATION_FIELDS,
  normalizeGeneration,
  type GenerationField,
  type GenerationForm,
} from './formState';

interface AdvancedPanelProps {
  id: string;
  value: GenerationForm;
  onChange: (value: GenerationForm) => void;
}

const MEMORY_PRESETS = [
  { id: 'standard', historyTurns: '', memoriesRecalled: '' },
  { id: 'long', historyTurns: '120', memoriesRecalled: '24' },
  { id: 'epic1m', historyTurns: '400', memoriesRecalled: '48' },
  { id: 'max1m', historyTurns: '1000', memoriesRecalled: '80' },
] as const;

export function AdvancedPanel({ id, value, onChange }: AdvancedPanelProps) {
  const { t } = useTranslation();
  const numbers = new Intl.NumberFormat(languageTag(useLocale()));
  const isAllDefault = GENERATION_FIELDS.every((field) => value[field] === '');

  const set = (field: GenerationField, text: string) => onChange({ ...value, [field]: text });

  return (
    <div className="settings-panel">
      <div className="settings-panel__intro">
        <p className="field__hint">{t('settings.advanced.intro')}</p>
        <button
          type="button"
          className="btn btn--small"
          disabled={isAllDefault}
          onClick={() => onChange(DEFAULT_GENERATION_FORM)}
        >
          {t('settings.advanced.reset')}
        </button>
      </div>

      <div className="field">
        <span className="field__label">{t('settings.advanced.presetsLabel')}</span>
        <div className="advanced-presets" role="group" aria-label={t('settings.advanced.presetsLabel')}>
          {MEMORY_PRESETS.map((preset) => {
            const active =
              value.historyTurns === preset.historyTurns && value.memoriesRecalled === preset.memoriesRecalled;
            return (
              <button
                key={preset.id}
                type="button"
                className={`btn btn--small${active ? ' btn--primary' : ''}`}
                onClick={() =>
                  onChange({
                    ...value,
                    historyTurns: preset.historyTurns,
                    memoriesRecalled: preset.memoriesRecalled,
                  })
                }
              >
                {t(`settings.advanced.presets.${preset.id}`)}
              </button>
            );
          })}
        </div>
        <p className="field__hint">{t('settings.advanced.presetsHint')}</p>
      </div>

      {GENERATION_FIELDS.map((field) => {
        const { min, max } = GENERATION_LIMITS[field];
        const fallback = GENERATION_DEFAULTS[field];
        const inputId = `${id}-${field}`;
        const placeholder =
          fallback === null
            ? t('settings.advanced.providerDefault')
            : t('settings.advanced.defaultIs', { value: numbers.format(fallback) });
        return (
          <div key={field} className="field">
            <div className="field__label-row">
              <label className="field__label" htmlFor={inputId}>
                {t(`settings.advanced.${field}`)}
              </label>
              {value[field] !== '' && (
                <button type="button" className="link-btn field__aside" onClick={() => set(field, '')}>
                  {t('settings.advanced.useDefault')}
                </button>
              )}
            </div>
            <input
              id={inputId}
              className="input input--number"
              type="number"
              inputMode={field === 'temperature' ? 'decimal' : 'numeric'}
              min={min}
              max={max}
              step={field === 'temperature' ? 0.1 : 1}
              value={value[field]}
              placeholder={placeholder}
              aria-describedby={`${inputId}-hint`}
              onChange={(event) => set(field, event.target.value)}
              // Out-of-range or fractional input is pulled into range when the field is left.
              onBlur={(event) => set(field, normalizeGeneration(field, event.target.value))}
            />
            <p id={`${inputId}-hint`} className="field__hint">
              {t(`settings.advanced.${field}Hint`)}
              <br />
              {t('settings.advanced.range', { min: numbers.format(min), max: numbers.format(max) })}
            </p>
          </div>
        );
      })}
    </div>
  );
}
