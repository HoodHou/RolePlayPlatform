import { useTranslation } from 'react-i18next';
import type { UiError } from '../../api/errors';
import { describeError } from '../../lib/describe';

export type ModelFetch =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; models: string[] }
  | { status: 'error'; error: UiError };

/** The fetch-related props every model field for one target shares. */
export interface ModelListProps {
  fetch: ModelFetch;
  /** The list uses saved settings; when the form differs, the button saves first. */
  needsSave: boolean;
  busy: boolean;
  onFetch: () => void;
}

interface ModelFieldProps {
  id: string;
  /** Defaults to "Model". */
  label?: string;
  value: string;
  placeholder: string;
  hint: string;
  /** Suggested model IDs offered as one-click chips. */
  presets?: readonly string[];
  /** Highlight the hint (e.g. a required field left empty). */
  warning?: boolean;
  fetch: ModelFetch;
  /** The list uses saved settings; when the form differs, the button saves first. */
  needsSave: boolean;
  busy: boolean;
  onChange: (value: string) => void;
  onFetch: () => void;
}

/** A free-text model input with a "Fetch models" button that offers the provider's list as suggestions. */
export function ModelField({
  id,
  label,
  value,
  placeholder,
  hint,
  presets,
  warning,
  fetch,
  needsSave,
  busy,
  onChange,
  onFetch,
}: ModelFieldProps) {
  const { t } = useTranslation();
  const models = fetch.status === 'ready' ? fetch.models : [];
  const listId = `${id}-models`;

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label ?? t('settings.model')}
      </label>
      <div className="input-row">
        <input
          id={id}
          className="input input--mono"
          type="text"
          autoComplete="off"
          spellCheck={false}
          list={models.length > 0 ? listId : undefined}
          value={value}
          placeholder={placeholder}
          aria-describedby={`${id}-hint`}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="btn btn--small input-row__button"
          disabled={busy || fetch.status === 'loading'}
          aria-describedby={needsSave ? `${id}-save-hint` : undefined}
          onClick={onFetch}
        >
          {fetch.status === 'loading'
            ? t('settings.fetchingModels')
            : needsSave
              ? t('settings.saveAndFetchModels')
              : t('settings.fetchModels')}
        </button>
      </div>

      {presets && presets.length > 0 && (
        <div className="preset-row" role="group" aria-labelledby={`${id}-presets`}>
          <span id={`${id}-presets`} className="field__hint">
            {t('settings.quickFill')}
          </span>
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              className="chip-button"
              aria-pressed={value.trim() === preset}
              onClick={() => onChange(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
      )}

      {models.length > 0 && (
        <>
          <datalist id={listId}>
            {models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
          <select
            className="input select model-picker"
            aria-label={t('settings.availableModels')}
            value=""
            onChange={(event) => {
              if (event.target.value) onChange(event.target.value);
            }}
          >
            <option value="">{t('settings.chooseModel', { count: models.length })}</option>
            {models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </>
      )}
      {fetch.status === 'ready' && models.length === 0 && <p className="field__hint">{t('settings.noModels')}</p>}
      {fetch.status === 'error' && (
        <p className="field__hint field__hint--error" role="alert">
          {t('settings.modelsFailed')}
          <br />
          {describeError(t, fetch.error)}
        </p>
      )}

      <p id={`${id}-hint`} className={warning ? 'field__hint field__hint--warning' : 'field__hint'}>
        {hint}
      </p>
      {needsSave && (
        <p id={`${id}-save-hint`} className="field__hint">
          {t('settings.saveAndFetchHint')}
        </p>
      )}
    </div>
  );
}
