import { EFFORTS, type Effort } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';

function isEffort(value: string): value is Effort {
  return (EFFORTS as readonly string[]).includes(value);
}

interface EffortFieldProps {
  id: string;
  value: Effort | null;
  /** The levels the role's provider has names for. */
  levels: readonly Effort[];
  onChange: (effort: Effort | null) => void;
}

/** Thinking effort: "Default" (null) plus exactly the levels this provider has. */
export function EffortField({ id, value, levels, onChange }: EffortFieldProps) {
  const { t } = useTranslation();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {t('settings.effort.label')}
      </label>
      <select
        id={id}
        className="input select"
        value={value ?? ''}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(isEffort(event.target.value) ? event.target.value : null)}
      >
        <option value="">{t('settings.effort.default')}</option>
        {levels.map((level) => (
          <option key={level} value={level}>
            {t(`settings.effort.levels.${level}`)}
          </option>
        ))}
      </select>
      <p id={`${id}-hint`} className="field__hint">
        {t('settings.effort.hint')}
        <br />
        {t('settings.effort.support')}
      </p>
    </div>
  );
}
