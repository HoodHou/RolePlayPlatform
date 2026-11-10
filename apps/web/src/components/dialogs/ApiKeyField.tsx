import type { KeySource } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';

/** What the player did with a key field: typed a new key, or asked to remove the saved one. */
export interface KeyEdit {
  value: string;
  remove: boolean;
}

export const NO_KEY_EDIT: KeyEdit = { value: '', remove: false };

/** The `apiKey` part of a settings update: only sent when the player changed something. */
export function keyPatch(edit: KeyEdit): { apiKey?: string | null } {
  const key = edit.value.trim();
  if (key) return { apiKey: key };
  if (edit.remove) return { apiKey: null };
  return {};
}

interface ApiKeyFieldProps {
  id: string;
  source: KeySource;
  edit: KeyEdit;
  onChange: (edit: KeyEdit) => void;
  extraHint?: string;
}

/** A write-only key input: the stored key is never sent to the browser, only where it comes from. */
export function ApiKeyField({ id, source, edit, onChange, extraHint }: ApiKeyFieldProps) {
  const { t } = useTranslation();
  const status = edit.remove ? t('settings.keyRemovalPending') : t(`settings.keySource.${source}`);
  const canRemove = source === 'settings' && edit.value === '';

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {t('settings.apiKey')}
      </label>
      <p id={`${id}-status`} className={`key-status key-status--${edit.remove ? 'removing' : source}`}>
        <span className="key-status__dot" aria-hidden="true" />
        <span>{status}</span>
        {canRemove &&
          (edit.remove ? (
            <button type="button" className="link-btn" onClick={() => onChange(NO_KEY_EDIT)}>
              {t('settings.undo')}
            </button>
          ) : (
            <button type="button" className="link-btn" onClick={() => onChange({ value: '', remove: true })}>
              {t('settings.removeKey')}
            </button>
          ))}
      </p>
      <input
        id={id}
        className="input input--mono"
        type="password"
        autoComplete="new-password"
        spellCheck={false}
        value={edit.value}
        placeholder={source === 'settings' ? t('settings.keyReplacePlaceholder') : t('settings.keyPlaceholder')}
        aria-describedby={`${id}-status ${id}-hint`}
        onChange={(event) => onChange({ value: event.target.value, remove: false })}
      />
      <p id={`${id}-hint`} className="field__hint">
        {t('settings.keyHint')}
        {extraHint && (
          <>
            <br />
            {extraHint}
          </>
        )}
      </p>
    </div>
  );
}
