import { CONNECTION_DEFAULTS, PROVIDER_KINDS, type ConnectionKind, type ProviderKind, type PublicSettings } from '@roleplay/shared';
import { useTranslation } from 'react-i18next';
import { Icon } from '../Icon';
import { EffortField } from './EffortField';
import {
  actorProvider,
  connectionIssue,
  effortsFor,
  isConnectionKind,
  type ActorForm,
  type RoleForm,
  type SettingsFormState,
} from './formState';
import { ModelField, type ModelListProps } from './ModelField';

interface RolesPanelProps {
  id: string;
  form: SettingsFormState;
  saved: PublicSettings;
  onGameMaster: (patch: Partial<RoleForm>) => void;
  onActor: (patch: Partial<ActorForm>) => void;
  modelList: (kind: ConnectionKind) => ModelListProps;
  onGoToConnection: (kind: ConnectionKind) => void;
}

/** A warning when the connection a role uses cannot work yet, with a way to fix it. */
function ConnectionWarning({ kind, form, saved, onGo }: { kind: ConnectionKind; form: SettingsFormState; saved: PublicSettings; onGo: () => void }) {
  const { t } = useTranslation();
  const issue = connectionIssue(kind, form, saved);
  if (!issue) return null;
  const message =
    issue === 'noBaseUrl'
      ? t('settings.roles.noBaseUrl')
      : issue === 'noKeyOptional'
        ? t('settings.roles.noKeyOptional')
        : t('settings.roles.noKey', { name: t(`settings.providers.${kind}.name`) });
  return (
    <p className={issue === 'noKeyOptional' ? 'role-warning is-soft' : 'role-warning'}>
      <Icon name="alert" size={15} className="role-warning__icon" />
      <span>
        {message}{' '}
        <button type="button" className="link-btn" onClick={onGo}>
          {t('settings.roles.goToConnection')}
        </button>
      </span>
    </p>
  );
}

const PROVIDER_CHOICES: ReadonlyArray<ProviderKind | 'same'> = ['same', ...PROVIDER_KINDS];

function ProviderSelect({
  id,
  value,
  withSame,
  onChange,
}: {
  id: string;
  value: ProviderKind | 'same';
  withSame: boolean;
  onChange: (value: ProviderKind | 'same') => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {t('settings.roles.provider')}
      </label>
      <select
        id={id}
        className="input select"
        value={value}
        onChange={(event) => {
          const next = PROVIDER_CHOICES.find((choice) => choice === event.target.value);
          if (next) onChange(next);
        }}
      >
        {withSame && <option value="same">{t('settings.roles.same')}</option>}
        {PROVIDER_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {t(`settings.providers.${kind}.name`)}
          </option>
        ))}
      </select>
      {value !== 'same' && <p className="field__hint">{t(`settings.providers.${value}.description`)}</p>}
    </div>
  );
}

/** Model and thinking effort for a role on a real connection. */
function RoleModel({
  id,
  kind,
  role,
  form,
  onChange,
  modelList,
}: {
  id: string;
  kind: ConnectionKind;
  role: { model: string; effort: RoleForm['effort'] };
  form: SettingsFormState;
  onChange: (patch: Partial<Pick<RoleForm, 'model' | 'effort'>>) => void;
  modelList: ModelListProps;
}) {
  const { t } = useTranslation();
  const fallback = form.connections[kind].model.trim() || CONNECTION_DEFAULTS[kind].model;
  return (
    <>
      <ModelField
        id={`${id}-model`}
        value={role.model}
        placeholder={fallback || t('settings.modelPlaceholder')}
        hint={fallback ? t('settings.roles.modelHint', { model: fallback }) : t('settings.roles.modelHintNoDefault')}
        onChange={(model) => onChange({ model })}
        {...modelList}
      />
      <EffortField id={`${id}-effort`} value={role.effort} levels={effortsFor(kind)} onChange={(effort) => onChange({ effort })} />
    </>
  );
}

export function RolesPanel({ id, form, saved, onGameMaster, onActor, modelList, onGoToConnection }: RolesPanelProps) {
  const { t } = useTranslation();
  const gm = form.gameMaster;
  const actor = form.actor;
  const followed = actorProvider(form);
  const gmKind = isConnectionKind(gm.provider) ? gm.provider : null;
  const actorKind = actor.provider !== 'same' && isConnectionKind(actor.provider) ? actor.provider : null;

  return (
    <div className="settings-panel">
      <p className="field__hint">{t('settings.roles.intro')}</p>

      <section className="role-block" aria-labelledby={`${id}-gm-title`}>
        <h3 id={`${id}-gm-title`} className="settings-section__title">
          {t('settings.roles.gameMaster')}
        </h3>
        <p className="field__hint">{t('settings.roles.gameMasterHint')}</p>
        <ProviderSelect
          id={`${id}-gm-provider`}
          value={gm.provider}
          withSame={false}
          onChange={(provider) => provider !== 'same' && onGameMaster({ provider })}
        />
        {gmKind ? (
          <>
            <ConnectionWarning kind={gmKind} form={form} saved={saved} onGo={() => onGoToConnection(gmKind)} />
            <RoleModel id={`${id}-gm`} kind={gmKind} role={gm} form={form} onChange={onGameMaster} modelList={modelList(gmKind)} />
          </>
        ) : (
          <p className="provider-config__note">{t('settings.roles.mockNote')}</p>
        )}
      </section>

      <section className="role-block" aria-labelledby={`${id}-actor-title`}>
        <h3 id={`${id}-actor-title`} className="settings-section__title">
          {t('settings.roles.actor')}
        </h3>
        <p className="field__hint">{t('settings.roles.actorHint')}</p>
        <ProviderSelect id={`${id}-actor-provider`} value={actor.provider} withSame onChange={(provider) => onActor({ provider })} />
        {actor.provider === 'same' ? (
          <>
            <p className="provider-config__note">{t('settings.roles.sameNote')}</p>
            {isConnectionKind(followed) && (
              <EffortField
                id={`${id}-actor-effort`}
                value={actor.effort}
                levels={effortsFor(followed)}
                onChange={(effort) => onActor({ effort })}
              />
            )}
          </>
        ) : actorKind ? (
          <>
            <ConnectionWarning kind={actorKind} form={form} saved={saved} onGo={() => onGoToConnection(actorKind)} />
            <RoleModel
              id={`${id}-actor`}
              kind={actorKind}
              role={actor}
              form={form}
              onChange={onActor}
              modelList={modelList(actorKind)}
            />
          </>
        ) : (
          <p className="provider-config__note">{t('settings.roles.mockNote')}</p>
        )}
      </section>
    </div>
  );
}
