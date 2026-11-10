import { CONNECTION_DEFAULTS, CONNECTION_KINDS, CUSTOM_ENDPOINT_PRESETS, type ConnectionKind, type PublicSettings } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { languageTag, useLocale } from '../../i18n';
import { formatList } from '../../lib/text';
import { ApiKeyField } from './ApiKeyField';
import { rolesUsing, type ConnectionForm, type SettingsFormState } from './formState';
import { ModelField, type ModelListProps } from './ModelField';

interface ConnectionsPanelProps {
  form: SettingsFormState;
  saved: PublicSettings;
  onChange: (kind: ConnectionKind, patch: Partial<ConnectionForm>) => void;
  modelList: (kind: ConnectionKind) => ModelListProps;
  /** Ids of the key and base-URL inputs, so Quick setup and role warnings can jump to them. */
  fieldId: (kind: ConnectionKind, field: 'key' | 'url' | 'model') => string;
}

interface ConnectionBlockProps extends Omit<ConnectionsPanelProps, 'onChange' | 'modelList'> {
  kind: ConnectionKind;
  onChange: (patch: Partial<ConnectionForm>) => void;
  modelList: ModelListProps;
}

function ConnectionBlock({ kind, form, saved, onChange, modelList, fieldId }: ConnectionBlockProps) {
  const { t } = useTranslation();
  const uiTag = languageTag(useLocale());
  const value = form.connections[kind];
  const roles = rolesUsing(kind, form);
  const defaults = CONNECTION_DEFAULTS[kind];
  const isCustom = kind === 'custom';
  const missingUrl = isCustom && roles.length > 0 && value.baseUrl.trim() === '';
  const urlId = fieldId(kind, 'url');

  return (
    <section className={roles.length > 0 ? 'connection is-used' : 'connection'} aria-labelledby={`${urlId}-title`}>
      <div className="connection__head">
        <h3 id={`${urlId}-title`} className="settings-section__title">
          {t(`settings.providers.${kind}.name`)}
        </h3>
        <span className={roles.length > 0 ? 'tag tag--accent' : 'tag'}>
          {roles.length > 0
            ? t('settings.connections.usedBy', {
                roles: formatList(
                  roles.map((role) => t(`settings.roles.${role}`)),
                  uiTag,
                ),
              })
            : t('settings.connections.unused')}
        </span>
      </div>
      <p className="field__hint">{t(`settings.connections.descriptions.${kind}`)}</p>

      <ApiKeyField
        id={fieldId(kind, 'key')}
        source={saved.connections[kind]?.apiKeySource ?? 'none'}
        edit={value.key}
        onChange={(key) => onChange({ key })}
        extraHint={isCustom ? t('settings.connections.localKeyHint') : undefined}
      />

      <div className="field">
        <label className="field__label" htmlFor={urlId}>
          {t('settings.baseUrl')}
        </label>
        <input
          id={urlId}
          className="input input--mono"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={value.baseUrl}
          placeholder={defaults.baseUrl || (isCustom ? 'https://…/v1' : t('settings.connections.officialEndpoint'))}
          aria-describedby={`${urlId}-hint`}
          aria-invalid={missingUrl || undefined}
          onChange={(event) => onChange({ baseUrl: event.target.value })}
        />
        {isCustom && (
          <div className="preset-row" role="group" aria-labelledby={`${urlId}-presets`}>
            <span id={`${urlId}-presets`} className="field__hint">
              {t('settings.quickFill')}
            </span>
            {CUSTOM_ENDPOINT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="chip-button"
                aria-pressed={value.baseUrl.trim() === preset.baseUrl}
                title={preset.model ? `${preset.baseUrl} · ${preset.model}` : preset.baseUrl}
                onClick={() =>
                  onChange(preset.model ? { baseUrl: preset.baseUrl, model: preset.model } : { baseUrl: preset.baseUrl })
                }
              >
                {preset.name}
              </button>
            ))}
          </div>
        )}
        <p id={`${urlId}-hint`} className={missingUrl ? 'field__hint field__hint--warning' : 'field__hint'}>
          {isCustom ? t('settings.connections.customBaseUrlHint') : t('settings.connections.baseUrlHint')}
          {missingUrl && (
            <>
              <br />
              {t('settings.connections.customBaseUrlRequired')}
            </>
          )}
        </p>
      </div>

      <ModelField
        id={fieldId(kind, 'model')}
        label={t('settings.connections.defaultModel')}
        value={value.model}
        placeholder={defaults.model || t('settings.modelPlaceholder')}
        hint={
          defaults.model
            ? t('settings.connections.defaultModelHintWithDefault', { model: defaults.model })
            : t('settings.connections.defaultModelHint')
        }
        onChange={(model) => onChange({ model })}
        {...modelList}
      />
    </section>
  );
}

export function ConnectionsPanel({ form, saved, onChange, modelList, fieldId }: ConnectionsPanelProps) {
  const { t } = useTranslation();
  return (
    <div className="settings-panel">
      <p className="field__hint">{t('settings.connections.intro')}</p>
      {CONNECTION_KINDS.map((kind) => (
        <ConnectionBlock
          key={kind}
          kind={kind}
          form={form}
          saved={saved}
          onChange={(patch) => onChange(kind, patch)}
          modelList={modelList(kind)}
          fieldId={fieldId}
        />
      ))}
    </div>
  );
}
